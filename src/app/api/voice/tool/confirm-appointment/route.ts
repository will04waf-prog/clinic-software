/**
 * POST /api/voice/tool/confirm-appointment — Phase 5 W2.
 *
 * Outbound reminder bot calls this when the patient verbally
 * confirms they're still coming to a scheduled consultation.
 * Caller-ID-gated (same pattern as cancel-appointment /
 * reschedule-appointment): we never trust an LLM-supplied phone
 * number; identity comes from the Vapi envelope's customer.number.
 *
 * Lifecycle: consultation_id MUST come from the call metadata that
 * the reminder cron injected at outbound-call time, NOT from the
 * patient's free-form speech. We still re-resolve the contact by
 * caller-ID and require the consultation to belong to that contact,
 * so a forged or stale id is safe-fail.
 *
 * State transition: status='scheduled' → status='confirmed'.
 * Rows already 'confirmed' are returned as success-no-op (the cron
 * may retry on a webhook race). Rows in any other state (canceled,
 * completed, no_show, rescheduled, hold) are refused with
 * not_confirmable_or_not_yours — matching the cancel-route shape.
 *
 * No SMS side-effect: the patient is on the phone hearing the
 * confirmation in real time, and sending an SMS in the middle of a
 * voice confirmation would feel doubled up. Owner gets a PHI-free
 * "confirmed" email so they can see overnight which reminder calls
 * landed.
 */

import { NextResponse, after } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { verifyVapiSignature } from '@/lib/voice-agent/verify-vapi-signature'
import { toolCallFromVapiPayload, toolCallResponseForVapi } from '@/lib/voice-agent/tool-types'
import { resolveCallEnvelope } from '@/lib/voice-agent/resolve-envelope'
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
  if (!consultationId) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: false,
      error: 'consultation_id is required (from the outbound-call metadata)',
    }))
  }

  // CRITICAL: identity comes ONLY from the Vapi envelope in prod.
  // The reminder bot doesn't need a special-cased outbound envelope
  // — Vapi forwards the patient's phone as customer.number on
  // outbound calls just like inbound, and the org's twilio number
  // as phoneNumber.number, so resolveCallEnvelope works unchanged.
  const { toE164, fromE164 } = await resolveCallEnvelope(tc)
  if (!toE164 || !fromE164) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: false,
      error: 'Missing call envelope (to_e164 / from_e164)',
    }))
  }

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('id, name, call_agent_enabled, call_agent_baa_attested_at')
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

  // Caller-ID resolution. Same last-10 ilike + JS exact-compare
  // pattern as the cancel/reschedule routes. > 1 exact match is
  // ambiguous and we refuse to pick.
  const last10 = fromE164.replace(/\D/g, '').slice(-10)
  if (last10.length !== 10) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: false,
      error: 'Unparseable caller id',
    }))
  }
  const { data: candidates } = await supabaseAdmin
    .from('contacts_active')
    .select('id, first_name, phone')
    .eq('organization_id', org.id)
    .ilike('phone', `%${last10}`)
    .limit(5)
  const exactMatches = (candidates ?? []).filter(
    c => (c.phone ?? '').replace(/\D/g, '').slice(-10) === last10,
  )
  if (exactMatches.length > 1) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: true,
      output: { confirmed: false, reason: 'ambiguous_caller_id' },
    }))
  }
  const contact = exactMatches[0]
  if (!contact) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: true,
      output: { confirmed: false, reason: 'caller_not_recognized' },
    }))
  }

  // Atomic UPDATE — only flips a row that is BOTH owned by the
  // resolved contact AND currently 'scheduled'. We deliberately
  // exclude 'confirmed' from the eligible set so a duplicate
  // tool-call doesn't fire two owner emails; the no-op branch
  // below detects "already confirmed" by re-reading the row.
  const nowIso = new Date().toISOString()
  const { data: updated, error: updErr } = await supabaseAdmin
    .from('consultations')
    .update({ status: 'confirmed', updated_at: nowIso })
    .eq('id', consultationId)
    .eq('organization_id', org.id)
    .eq('contact_id', contact.id!)
    .eq('status', 'scheduled')
    .select('id, scheduled_at, contact_id')
    .maybeSingle()
  if (updErr) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: false,
      error: `confirm_failed: ${updErr.message}`,
    }))
  }
  if (!updated) {
    // The UPDATE matched zero rows. Two possibilities:
    //  (a) consultation already 'confirmed' from a prior retry —
    //      surface as success-no-op so the LLM doesn't loop;
    //  (b) consultation doesn't belong to this caller / is in a
    //      non-confirmable state — surface as the explicit reason.
    const { data: existing } = await supabaseAdmin
      .from('consultations')
      .select('id, status')
      .eq('id', consultationId)
      .eq('organization_id', org.id)
      .eq('contact_id', contact.id!)
      .maybeSingle()
    if (existing?.status === 'confirmed') {
      return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
        ok: true,
        output: { confirmed: true, consultation_id: existing.id, already: true },
      }))
    }
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: true,
      output: { confirmed: false, reason: 'not_confirmable_or_not_yours' },
    }))
  }

  // Stamp the voice_reminder_status terminal state alongside the
  // status flip. Two writes are intentional: status='confirmed'
  // belongs to the public consultations lifecycle (visible to the
  // owner's calendar grid + automation engine), while
  // voice_reminder_status='confirmed' is purely the reminder-cron's
  // ledger entry — it tells the next cron tick "we already handled
  // this row" and feeds the operator's "what happened to that
  // reminder call?" SELECT.
  await supabaseAdmin
    .from('consultations')
    .update({ voice_reminder_status: 'confirmed' })
    .eq('id', updated.id)

  // Audit row. Dedicated action name so the timeline can show a
  // "voice-confirmed" icon and the owner can answer "who confirmed
  // this?" with phone-call vs. /manage tap vs. in-app click.
  await supabaseAdmin.from('activity_log').insert({
    organization_id: org.id,
    contact_id:      contact.id,
    action:          'consultation_confirmed_voice',
    metadata: {
      consultation_id: updated.id,
      scheduled_at:    updated.scheduled_at,
      call_sid:        tc.callSid ?? null,
      from_e164_tail:  (fromE164 ?? '').slice(-4),
    },
  })

  // Owner notification — PHI-free, deep-link to the calendar grid
  // so the owner can see overnight which reminder calls landed.
  // Idempotent via the activity_log dedupe key inside the helper.
  after(async () => {
    try {
      await notifyOwnerOfBooking({
        organizationId: org.id,
        consultationId: updated.id,
        scheduledAtIso: updated.scheduled_at,
        kind: 'confirmed',
      })
    } catch {
      console.error('[voice/confirm-appointment owner notification] failed')
    }
  })

  return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
    ok: true,
    output: {
      confirmed: true,
      consultation_id: updated.id,
    },
  }))
}
