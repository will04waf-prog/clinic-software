/**
 * POST /api/voice/tool/reschedule-appointment — Phase 5 W2.
 *
 * Caller-ID-gated reschedule. Same identity model as cancel-appointment:
 * the consultation must belong to the contact resolved from the
 * caller's number, AND it must still be in a reschedulable state
 * ('scheduled' or 'confirmed').
 *
 * Atomic UPDATE — flips scheduled_at + provider_id in one shot. The
 * EXCLUDE constraint on (provider_id, time_range) for non-canceled
 * rows means a race against another booking for the same slot fails
 * the UPDATE cleanly; we surface that as slot_taken so the LLM can
 * offer the caller another slot.
 *
 * Layla flow:
 *   1. lookup_my_appointments → caller picks which to reschedule
 *   2. lookup_availability    → caller picks a new slot
 *   3. reschedule_appointment with consultation_id + new slot
 *
 * Mirrors the downstream effects of /api/booking/reschedule + voice/
 * cancel: activity_log audit, patient confirmation SMS, owner email.
 */

import { NextResponse, after } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { verifyVapiSignature } from '@/lib/voice-agent/verify-vapi-signature'
import { toolCallFromVapiPayload, toolCallResponseForVapi } from '@/lib/voice-agent/tool-types'
import { resolveCallEnvelope } from '@/lib/voice-agent/resolve-envelope'
import { sendSMS, isTwilioConfigured } from '@/lib/twilio'
import { notifyOwnerOfBooking } from '@/lib/booking/owner-notification'
import { assertSlotBookable } from '@/lib/booking/assert-slot-bookable'

export async function POST(req: Request) {
  if (!verifyVapiSignature(req)) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const tc = toolCallFromVapiPayload(body)
  if (!tc) {
    return NextResponse.json({ error: 'unrecognized_payload_shape' }, { status: 400 })
  }

  const consultationId = typeof tc.arguments.consultation_id === 'string'
    ? tc.arguments.consultation_id
    : undefined
  const newSlotStart = typeof tc.arguments.new_slot_start_utc === 'string'
    ? tc.arguments.new_slot_start_utc
    : undefined
  const newProviderId = typeof tc.arguments.new_provider_id === 'string'
    ? tc.arguments.new_provider_id
    : undefined
  if (!consultationId || !newSlotStart) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: false,
      error: 'consultation_id and new_slot_start_utc are required',
    }))
  }
  const newStartDate = new Date(newSlotStart)
  if (Number.isNaN(newStartDate.getTime()) || newStartDate.getTime() < Date.now()) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: false,
      error: 'new_slot_start_utc must be a future ISO timestamp',
    }))
  }

  // CRITICAL: identity from envelope only — never from LLM args in prod.
  const { toE164, fromE164 } = await resolveCallEnvelope(tc)
  if (!toE164 || !fromE164) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: false,
      error: 'Missing call envelope (to_e164 / from_e164)',
    }))
  }

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('id, name, timezone, call_agent_enabled, call_agent_baa_attested_at, sms_enabled, sms_confirmation_enabled')
    .eq('twilio_phone_number', toE164)
    .maybeSingle()
  if (!org) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: false,
      error: 'No business mapped to this number',
    }))
  }
  if (!org.call_agent_enabled || !org.call_agent_baa_attested_at) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: false,
      error: 'Voice agent is not enabled for this business',
    }))
  }

  // Resolve contact by caller ID (or the override phone Layla passed).
  const last10 = fromE164.replace(/\D/g, '').slice(-10)
  if (last10.length !== 10) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: false,
      error: 'Unparseable caller id',
    }))
  }
  // Use contacts_active (soft-delete-aware view) so the lookup here
  // matches the same row the SMS-send block reads. Earlier code
  // looked up via contacts.is_archived=false but the SMS step
  // re-reads via contacts_active, so a soft-deleted contact would
  // get rescheduled silently with no patient SMS confirmation.
  const { data: candidates } = await supabaseAdmin
    .from('contacts_active')
    .select('id, first_name, phone')
    .eq('organization_id', org.id)
    .ilike('phone', `%${last10}`)
    .limit(5)
  const exactMatches = (candidates ?? []).filter(
    c => (c.phone ?? '').replace(/\D/g, '').slice(-10) === last10,
  )
  // Collision guard — two contacts in the same org sharing the same
  // trailing 10 digits would otherwise allow rescheduling under the
  // wrong identity. Fall back so Layla can take_message instead.
  if (exactMatches.length > 1) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: true,
      output: { rescheduled: false, reason: 'ambiguous_caller_id' },
    }))
  }
  const contact = exactMatches[0]
  if (!contact) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: true,
      output: { rescheduled: false, reason: 'caller_not_recognized' },
    }))
  }

  // We need the existing consultation's duration so the new
  // time_range maintains it. Pull it first; if the row doesn't exist
  // OR isn't owned by the caller OR isn't reschedulable, bail.
  const { data: existing } = await supabaseAdmin
    .from('consultations')
    .select('id, scheduled_at, duration_min, service_id, provider_id, status')
    .eq('id', consultationId)
    .eq('organization_id', org.id)
    .eq('contact_id', contact.id!)
    .in('status', ['scheduled', 'confirmed'])
    .maybeSingle()
  if (!existing) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: true,
      output: { rescheduled: false, reason: 'not_reschedulable_or_not_yours' },
    }))
  }

  // Atomic UPDATE. The EXCLUDE constraint on (provider_id, time_range)
  // for non-canceled rows will fail this UPDATE if the target slot
  // overlaps another active booking — Postgres surfaces it as a
  // unique-violation we map to slot_taken.
  // Validate newProviderId belongs to this org before plumbing it
  // into the UPDATE. Without this check, the LLM could be coaxed into
  // passing any UUID (cross-tenant or non-existent) and Postgres
  // would happily write it as a foreign-key violation OR — worse if
  // the FK isn't enforced — a dangling reference.
  let providerForUpdate = existing.provider_id
  if (newProviderId) {
    const { data: validProvider } = await supabaseAdmin
      .from('providers')
      .select('id')
      .eq('id', newProviderId)
      .eq('organization_id', org.id)
      .eq('is_active', true)
      .maybeSingle()
    if (!validProvider) {
      return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
        ok: true,
        output: { rescheduled: false, reason: 'invalid_provider' },
      }))
    }
    providerForUpdate = newProviderId
  }

  // ── Availability re-check (audit M2 + M3) ──
  // The tool only checked new_slot_start_utc is a future ISO instant.
  // Ask the same engine the picker uses whether this exact instant is
  // offerable, so the LLM can't be coaxed into booking at 3 AM, on a
  // closed day, or inside the provider's configured buffer.
  if (providerForUpdate && existing.service_id) {
    const bookable = await assertSlotBookable(supabaseAdmin, {
      organizationId: org.id,
      providerId: providerForUpdate,
      serviceId: existing.service_id,
      startUtc: newStartDate,
      excludeConsultationId: consultationId,
    })
    if (!bookable.ok) {
      return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
        ok: true,
        output: { rescheduled: false, reason: 'slot_unavailable' },
      }))
    }
  }

  const nowIso = new Date().toISOString()
  // Concurrent-update guard: two near-simultaneous reschedule calls
  // for the same consultation (Vapi tool retry, double-click in a
  // hypothetical UI, a network blip that resends) would both observe
  // the same `existing` row, both UPDATE successfully, and both fire
  // patient SMS + owner email — the patient gets two confirmation
  // texts and the owner two notification emails for what is logically
  // one change. Pin the UPDATE to `existing.scheduled_at` so only the
  // first request matches; the second sees the already-updated
  // scheduled_at, .maybeSingle() returns null, and we return a clean
  // `already_rescheduled` reason rather than re-running the after()
  // side effects.
  const { data: updated, error: updErr } = await supabaseAdmin
    .from('consultations')
    .update({
      scheduled_at: newStartDate.toISOString(),
      provider_id:  providerForUpdate,
      updated_at:   nowIso,
    })
    .eq('id', consultationId)
    .eq('organization_id', org.id)
    .eq('contact_id', contact.id!)
    .eq('scheduled_at', existing.scheduled_at)
    .in('status', ['scheduled', 'confirmed'])
    .select('id, scheduled_at')
    .maybeSingle()
  if (updErr) {
    // 23P01 is the exclude-constraint violation code Postgres returns
    // when the new time range overlaps another booking.
    const msg = String(updErr.message || '').toLowerCase()
    const slotTaken = updErr.code === '23P01' || msg.includes('overlap') || msg.includes('exclude')
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: true,
      output: { rescheduled: false, reason: slotTaken ? 'slot_taken' : 'update_failed' },
    }))
  }
  if (!updated) {
    // Either the row was canceled/completed since the SELECT above
    // (status check failed) OR a concurrent reschedule already
    // changed scheduled_at out from under us. Distinguish: re-fetch
    // the row and look at its current state. If scheduled_at no
    // longer matches existing.scheduled_at, a sibling request won
    // the race — surface `already_rescheduled` so the LLM/caller
    // understands the change is in flight without re-firing SMS or
    // email side effects.
    const { data: recheck } = await supabaseAdmin
      .from('consultations')
      .select('scheduled_at, status')
      .eq('id', consultationId)
      .eq('organization_id', org.id)
      .eq('contact_id', contact.id!)
      .maybeSingle()
    const raced = recheck && recheck.scheduled_at !== existing.scheduled_at
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: true,
      output: {
        rescheduled: false,
        reason: raced ? 'already_rescheduled' : 'not_reschedulable_or_not_yours',
      },
    }))
  }

  // Retry-idempotency guard. Distinct from the in-flight concurrent
  // case above: if request A succeeded but its response was lost in
  // transit and Vapi retried, the retry re-fetches `existing`,
  // which now has scheduled_at = newTime (A's UPDATE landed). The
  // retry's UPDATE then matches (scheduled_at=newTime equals itself),
  // succeeds as a no-op, and would naively re-fire the after()
  // patient-SMS + owner-email. Catch it: an activity_log row for this
  // exact (consultation_id, new_scheduled) already exists from A.
  const { data: priorAudit } = await supabaseAdmin
    .from('activity_log')
    .select('id')
    .eq('organization_id', org.id)
    .eq('action', 'consultation_rescheduled_voice')
    .contains('metadata', { consultation_id: updated.id, new_scheduled: updated.scheduled_at })
    .limit(1)
  if (priorAudit && priorAudit.length > 0) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: true,
      output: { rescheduled: false, reason: 'already_rescheduled' },
    }))
  }

  // Audit row.
  await supabaseAdmin.from('activity_log').insert({
    organization_id: org.id,
    contact_id:      contact.id,
    action:          'consultation_rescheduled_voice',
    metadata: {
      consultation_id:    updated.id,
      previous_scheduled: existing.scheduled_at,
      new_scheduled:      updated.scheduled_at,
      call_sid:           tc.callSid ?? null,
      from_e164_tail:     (fromE164 ?? '').slice(-4),
    },
  })

  // Patient reschedule SMS — mirrors cancel SMS gating.
  after(async () => {
    try {
      const { data: contactSms } = await supabaseAdmin
        .from('contacts_active')
        .select('id, first_name, phone, opted_out_sms, sms_consent')
        .eq('id', contact.id!)
        .single()
      if (!contactSms) return
      if (
        !contactSms.phone ||
        !contactSms.sms_consent ||
        contactSms.opted_out_sms ||
        !org.sms_enabled ||
        org.sms_confirmation_enabled === false ||
        !isTwilioConfigured()
      ) return
      const firstName = contactSms.first_name || 'there'
      const tz = org.timezone || 'America/New_York'
      const when = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, weekday: 'long', month: 'long', day: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true,
      }).format(new Date(updated.scheduled_at))
      const text = `Hi ${firstName}, your appointment with ${org.name} is now ${when}. Reply STOP to opt out.`
      try {
        const result = await sendSMS(contactSms.phone, text)
        await supabaseAdmin.from('sms_log').insert({
          organization_id: org.id,
          contact_id:      contactSms.id,
          consultation_id: updated.id,
          message_type:    'confirmation',
          to_number:       contactSms.phone,
          body:            text,
          status:          'sent',
          provider_id:     result?.provider_id ?? null,
        })
      } catch (err: any) {
        await supabaseAdmin.from('sms_log').insert({
          organization_id: org.id,
          contact_id:      contactSms.id,
          consultation_id: updated.id,
          message_type:    'confirmation',
          to_number:       contactSms.phone,
          body:            text,
          status:          'failed',
          error_message:   err?.message ?? 'send failed',
        })
        console.error('[voice/reschedule sms] send failed')
      }
    } catch {
      console.error('[voice/reschedule sms] outer failure')
    }
  })

  after(async () => {
    try {
      await notifyOwnerOfBooking({
        organizationId: org.id,
        consultationId: updated.id,
        scheduledAtIso: updated.scheduled_at,
        kind: 'rescheduled',
      })
    } catch {
      console.error('[voice/reschedule owner notification] failed')
    }
  })

  return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
    ok: true,
    output: {
      rescheduled:     true,
      consultation_id: updated.id,
      new_scheduled_at: updated.scheduled_at,
    },
  }))
}
