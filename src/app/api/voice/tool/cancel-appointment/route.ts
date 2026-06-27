/**
 * POST /api/voice/tool/cancel-appointment — Phase 5 W1 extension.
 *
 * Caller-ID-gated cancellation. Layla calls this after the caller
 * confirms which upcoming consultation they want to drop. We re-
 * resolve the caller's contact by caller ID (NEVER trust an arg
 * naming the contact — the LLM could pick the wrong row) and only
 * allow cancellation of a consultation that genuinely belongs to
 * that contact AND is still in a cancelable state ('scheduled' or
 * 'confirmed').
 *
 * Threat model:
 *   - Same proof of identity as a human receptionist (caller ID +
 *     verbal confirmation of which appointment) — looser than a
 *     password but tighter than the /manage SMS link, which is a
 *     bearer token anyone with access to the patient's phone can
 *     use without further auth.
 *   - Spoofed caller ID can cancel real appointments. Mitigation:
 *     the patient receives an immediate cancellation SMS so they
 *     notice within seconds, plus the owner gets the same
 *     cancellation email the manage-link path sends.
 *
 * Mirrors /api/booking/cancel's downstream effects: atomic UPDATE
 * (cancelable-state-gated, idempotent on double-tap), activity_log
 * audit row, patient cancellation SMS, owner notification email.
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
  if (!consultationId) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: false,
      error: 'consultation_id is required (from a prior lookup_my_appointments result)',
    }))
  }

  // CRITICAL: identity comes ONLY from the Vapi envelope in prod.
  // resolveCallEnvelope refuses LLM-supplied to_e164/from_e164/
  // phone_number args in production — see lib/voice-agent/resolve-envelope.ts.
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
      output: { canceled: false, reason: 'caller_not_recognized' },
    }))
  }

  // Atomic UPDATE — only flips a row that is BOTH owned by the
  // resolved contact AND in a cancelable state. A forged
  // consultation_id from the LLM or a stale/canceled row drops
  // out via .maybeSingle()->null below.
  const nowIso = new Date().toISOString()
  const { data: updated, error: updErr } = await supabaseAdmin
    .from('consultations')
    .update({ status: 'canceled', updated_at: nowIso })
    .eq('id', consultationId)
    .eq('organization_id', org.id)
    .eq('contact_id', contact.id)
    .in('status', ['scheduled', 'confirmed'])
    .select('id, scheduled_at, organization_id, contact_id')
    .maybeSingle()
  if (updErr) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: false,
      error: `cancel_failed: ${updErr.message}`,
    }))
  }
  if (!updated) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: true,
      output: { canceled: false, reason: 'not_cancelable_or_not_yours' },
    }))
  }

  // Audit row. Distinguish from the SMS-manage-link path via the
  // dedicated action name so the timeline can show the right icon
  // and so the owner can answer "who canceled this" with phone
  // call vs link tap.
  await supabaseAdmin.from('activity_log').insert({
    organization_id: org.id,
    contact_id:      contact.id,
    action:          'consultation_canceled_voice',
    metadata: {
      consultation_id:  updated.id,
      was_scheduled_at: updated.scheduled_at,
      call_sid:         tc.callSid ?? null,
      from_e164_tail:   (fromE164 ?? '').slice(-4),
    },
  })

  // Patient cancellation SMS — same gating + copy as the SMS manage
  // path, just triggered from the voice channel.
  after(async () => {
    try {
      const { data: contactSms } = await supabaseAdmin
        .from('contacts_active')
        .select('id, first_name, phone, opted_out_sms, sms_consent')
        .eq('id', updated.contact_id)
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
      // Include the canceled time + service so a patient with multiple
      // appointments isn't confused about which one this refers to,
      // and so the SMS itself doubles as a notice-of-cancellation
      // record. Format in the clinic timezone.
      const tz = org.timezone || 'America/New_York'
      const when = updated.scheduled_at
        ? new Intl.DateTimeFormat('en-US', {
            timeZone: tz,
            weekday: 'long',
            month:   'long',
            day:     'numeric',
            hour:    'numeric',
            minute:  '2-digit',
            hour12:  true,
          }).format(new Date(updated.scheduled_at))
        : 'your upcoming visit'
      const text = `Hi ${firstName}, your ${when} appointment with ${org.name} has been canceled. Reply STOP to opt out.`
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
        console.error('[voice/cancel sms] send failed')
      }
    } catch {
      console.error('[voice/cancel sms] outer failure')
    }
  })

  after(async () => {
    try {
      await notifyOwnerOfBooking({
        organizationId: org.id,
        consultationId: updated.id,
        scheduledAtIso: updated.scheduled_at,
        kind: 'canceled',
      })
    } catch {
      console.error('[voice/cancel owner notification] failed')
    }
  })

  return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
    ok: true,
    output: {
      canceled: true,
      consultation_id: updated.id,
    },
  }))
}
