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
  const { toE164, fromE164 } = resolveCallEnvelope(tc)
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
      error: 'No clinic mapped to this number',
    }))
  }
  if (!org.call_agent_enabled || !org.call_agent_baa_attested_at) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: false,
      error: 'Voice agent is not enabled for this clinic',
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
  const { data: candidates } = await supabaseAdmin
    .from('contacts')
    .select('id, first_name, phone')
    .eq('organization_id', org.id)
    .eq('is_archived', false)
    .ilike('phone', `%${last10}`)
    .limit(5)
  const contact = (candidates ?? []).find(
    c => (c.phone ?? '').replace(/\D/g, '').slice(-10) === last10,
  )
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
    .eq('contact_id', contact.id)
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
  const providerForUpdate = newProviderId ?? existing.provider_id
  const nowIso = new Date().toISOString()
  const { data: updated, error: updErr } = await supabaseAdmin
    .from('consultations')
    .update({
      scheduled_at: newStartDate.toISOString(),
      provider_id:  providerForUpdate,
      updated_at:   nowIso,
    })
    .eq('id', consultationId)
    .eq('organization_id', org.id)
    .eq('contact_id', contact.id)
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
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: true,
      output: { rescheduled: false, reason: 'not_reschedulable_or_not_yours' },
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
      from_e164:          fromE164,
    },
  })

  // Patient reschedule SMS — mirrors cancel SMS gating.
  after(async () => {
    try {
      const { data: contactSms } = await supabaseAdmin
        .from('contacts_active')
        .select('id, first_name, phone, opted_out_sms, sms_consent')
        .eq('id', contact.id)
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
