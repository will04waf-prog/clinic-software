/**
 * POST /api/booking/cancel — Phase 4 W5.
 *
 * Token-authenticated. Flips a public-booked consultation from
 * 'scheduled' or 'confirmed' to 'canceled'. The status enum is
 * spelled with a single 'l' to match the migration (W1).
 *
 * Effects of status='canceled':
 *   - The EXCLUDE constraint on (provider_id, time_range) is partial
 *     WHERE status IN ('hold','scheduled','confirmed'), so a canceled
 *     row stops blocking other patients from that slot immediately.
 *   - The reminder cron's query filters status IN ('scheduled',
 *     'confirmed') — canceled rows are skipped, so the patient never
 *     gets a "your appointment is tomorrow" text for an appointment
 *     they cancelled.
 *
 * We do NOT delete the row; it stays on the calendar with status=
 * 'canceled' for the owner's audit trail.
 *
 * After the UPDATE: cancellation SMS to the patient + cancel email
 * to the owner via after().
 */

import { NextRequest, NextResponse, after } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { consume, ipFor, CANCEL_LIMIT } from '@/lib/booking/public-rate-limit'
import { verifyManageToken } from '@/lib/booking/manage-token'
import { sendSMS, isTwilioConfigured } from '@/lib/twilio'
import { notifyOwnerOfBooking } from '@/lib/booking/owner-notification'

const cancelSchema = z.object({
  manage_token: z.string().min(8),
})

export async function POST(req: NextRequest) {
  const ip = ipFor(req)
  const rl = consume(ip, CANCEL_LIMIT)
  if (!rl.ok) {
    return NextResponse.json(
      {
        error: 'rate_limited',
        message: `Too many requests. Try again in ${rl.retryAfterSeconds}s.`,
      },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    )
  }

  let rawBody: unknown
  try { rawBody = await req.json() } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  const parsed = cancelSchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input', message: parsed.error.issues[0].message }, { status: 400 })
  }

  const consultationId = verifyManageToken(parsed.data.manage_token)
  if (!consultationId) {
    return NextResponse.json({ error: 'invalid_token' }, { status: 401 })
  }

  const nowIso = new Date().toISOString()
  // Atomic UPDATE — only succeeds if the row is in a cancelable state.
  // Idempotent on double-tap: the second request matches no row (status
  // is already 'canceled') and we 410 below.
  const { data: updated, error: updateErr } = await supabaseAdmin
    .from('consultations')
    .update({
      status: 'canceled',
      updated_at: nowIso,
    })
    .eq('id', consultationId)
    .in('status', ['scheduled', 'confirmed'])
    .select('id, organization_id, contact_id, scheduled_at')
    .maybeSingle()
  if (updateErr) {
    return NextResponse.json({ error: 'cancel_failed', message: updateErr.message }, { status: 500 })
  }
  if (!updated) {
    // Could mean: row doesn't exist (token forged or stale beyond
    // hard-delete), status was already 'canceled', or row was never
    // in a cancelable state ('completed', 'no_show'). All three
    // collapse to the same patient-facing message.
    return NextResponse.json(
      {
        error: 'already_canceled_or_invalid',
        message: 'This booking is already canceled or cannot be canceled.',
      },
      { status: 410 },
    )
  }

  // Audit row. Forensics fields (ip, ua, token fingerprint) help the
  // owner audit "who canceled this booking" given the only actor
  // identity is "someone with the token."
  const tokenFingerprint = parsed.data.manage_token.slice(-12)
  const userAgent = req.headers.get('user-agent')?.slice(0, 200) ?? null
  await supabaseAdmin.from('activity_log').insert({
    organization_id: updated.organization_id,
    contact_id:      updated.contact_id,
    action:          'consultation_canceled_public',
    metadata: {
      consultation_id:   updated.id,
      was_scheduled_at:  updated.scheduled_at,
      ip,
      user_agent:        userAgent,
      token_fingerprint: tokenFingerprint,
    },
  })

  // ── Patient cancellation SMS ──
  // We don't reuse sendConsultationSms — that helper renders a
  // confirmation/reminder template tied to a future scheduled_at, and
  // we want a distinct "your appointment is canceled" line that won't
  // confuse the patient. Build a one-off message; honor the same
  // consent + opt-out + org-toggle gates so the path stays compliant.
  after(async () => {
    try {
      const [{ data: orgSms }, { data: contactSms }] = await Promise.all([
        supabaseAdmin
          .from('organizations')
          .select('name, timezone, sms_enabled, sms_confirmation_enabled')
          .eq('id', updated.organization_id)
          .single(),
        supabaseAdmin
          .from('contacts_active')
          .select('id, first_name, phone, opted_out_sms, sms_consent')
          .eq('id', updated.contact_id)
          .single(),
      ])
      if (!orgSms || !contactSms) {
        console.error('[cancel sms] precondition fetch returned null')
        return
      }
      // Gate identically to sendConsultationSms — we don't have a
      // "cancellation_enabled" toggle, so it piggybacks on the same
      // sms_confirmation_enabled flag (the patient gets the message
      // that closes the loop for the same booking they consented to).
      if (
        !contactSms.phone ||
        !contactSms.sms_consent ||
        contactSms.opted_out_sms ||
        !orgSms.sms_enabled ||
        orgSms.sms_confirmation_enabled === false ||
        !isTwilioConfigured()
      ) {
        return
      }
      const clinicName = (orgSms as { name: string }).name || 'your clinic'
      const firstName  = contactSms.first_name || 'there'
      const body = `Hi ${firstName}, your appointment with ${clinicName} has been canceled. Reply STOP to opt out.`
      const logBase = {
        organization_id: updated.organization_id,
        contact_id:      contactSms.id,
        consultation_id: updated.id,
        // sms_log.message_type is constrained to the SmsMessageType
        // enum — there's no 'cancellation' value. Use 'confirmation'
        // since cancellation closes the same booking-confirmation
        // loop; the audit row + body distinguish it.
        message_type:    'confirmation' as const,
        to_number:       contactSms.phone,
        body,
      }
      try {
        const result = await sendSMS(contactSms.phone, body)
        await supabaseAdmin.from('sms_log').insert({
          ...logBase,
          status:      'sent',
          provider_id: result?.provider_id ?? null,
        })
      } catch (err: any) {
        await supabaseAdmin.from('sms_log').insert({
          ...logBase,
          status:        'failed',
          error_message: err?.message ?? 'send failed',
        })
        console.error('[cancel sms] send failed')
      }
    } catch {
      console.error('[cancel sms] outer failure')
    }
  })

  after(async () => {
    try {
      await notifyOwnerOfBooking({
        organizationId: updated.organization_id,
        consultationId: updated.id,
        scheduledAtIso: updated.scheduled_at,
        kind: 'canceled',
      })
    } catch {
      console.error('[cancel owner notification] failed')
    }
  })

  return NextResponse.json({
    ok: true,
    consultation_id: updated.id,
  })
}
