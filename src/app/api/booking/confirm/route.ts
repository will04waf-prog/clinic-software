import { NextRequest, NextResponse, after } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { consume, ipFor, CONFIRM_LIMIT } from '@/lib/booking/public-rate-limit'
import { sendConsultationSms } from '@/lib/consultation-reminders'
import { notifyOwnerOfBooking } from '@/lib/booking/owner-notification'

/**
 * POST /api/booking/confirm — Phase 4 W2.
 *
 * Promotes a status='hold' consultation to status='scheduled' atomically:
 *   UPDATE consultations
 *     SET status='scheduled', hold_token=null, held_until=null
 *     WHERE id=$1 AND hold_token=$2 AND status='hold' AND held_until > now()
 *     RETURNING id
 *
 * Zero rows returned = the hold expired, was already confirmed, was
 * canceled by the cron, or the token doesn't match → 410 Gone with a
 * patient-friendly message. The patient is invited back to pick again.
 *
 * No new row is created here — the row already exists from /hold.
 * This means the EXCLUDE constraint that protected the slot during
 * the hold continues to protect it after confirmation. No race here.
 */

const confirmSchema = z.object({
  consultation_id: z.string().uuid(),
  hold_token:      z.string().uuid(),
})

export async function POST(req: NextRequest) {
  const ip = ipFor(req)
  const rl = consume(ip, CONFIRM_LIMIT)
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
  const parsed = confirmSchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input', message: parsed.error.issues[0].message }, { status: 400 })
  }
  const { consultation_id, hold_token } = parsed.data

  const nowIso = new Date().toISOString()
  // Contract: status='scheduled' is what makes this row eligible for
  // the 24h + 2h reminder cron (consultation-reminders.ts query uses
  // status IN ('scheduled','confirmed')). Don't change to a new
  // status without updating the reminder cron query in lockstep, or
  // public bookings will silently lose reminders.
  const { data, error } = await supabaseAdmin
    .from('consultations')
    .update({
      status:      'scheduled',
      hold_token:  null,
      held_until:  null,
      updated_at:  nowIso,
    })
    .eq('id',         consultation_id)
    .eq('hold_token', hold_token)
    .eq('status',     'hold')
    .gt('held_until', nowIso)
    .select('id, scheduled_at, duration_min, organization_id, contact_id, provider_id, service_id')
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: 'confirm_failed', message: error.message }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json(
      {
        error: 'hold_expired_or_invalid',
        message: 'This hold has expired or the token is invalid. Please pick a slot again.',
      },
      { status: 410 },
    )
  }

  // Activity-log audit row so the clinic can see public bookings flow
  // in alongside manual ones. We don't fire reminders here — the
  // existing W3 reminder cron picks up scheduled rows on its next tick.
  await supabaseAdmin.from('activity_log').insert({
    organization_id: data.organization_id,
    contact_id:      data.contact_id,
    action:          'consultation_booked_public',
    metadata: {
      consultation_id: data.id,
      provider_id:     data.provider_id,
      service_id:      data.service_id,
      scheduled_at:    data.scheduled_at,
      booked_via:      'public_page',
    },
  })

  // ── W4: close the booking loop ─────────────────────────────────
  // Patient gets a confirmation SMS; owner gets an email. Both run
  // via `after()` so the serverless runtime keeps the function alive
  // until they finish — a bare detached promise would be guillotined
  // when the response flushes, silently dropping the SMS/email. The
  // patient already sees "you're booked" client-side, so we never
  // want to block the 200 on Twilio/Resend latency either.
  //
  // Both blocks are INSIDE the if(data) branch so a duplicate POST
  // (patient triple-tapping) only fires notifications from the
  // winning request — the loser's UPDATE returns null and we 410
  // above before reaching here.
  //
  // DEFERRED to W5: enqueueEnrollment({triggerType:'consultation_booked'})
  // — the manual-booking path at /api/consultations/route.ts fires
  // this, but the public path intentionally does not yet. Owners with
  // configured "consultation_booked" automations will NOT see them
  // fire for public bookings until this is wired. Tracked as a known
  // asymmetry; revisit alongside reschedule/cancel in W5.
  after(async () => {
    try {
      const [{ data: orgSms }, { data: contactSms }] = await Promise.all([
        supabaseAdmin
          .from('organizations')
          .select(`
            name, timezone,
            sms_enabled, sms_confirmation_enabled,
            sms_template_confirmation
          `)
          .eq('id', data.organization_id)
          .single(),
        supabaseAdmin
          .from('contacts_active')
          .select('id, first_name, phone, opted_out_sms, sms_consent')
          .eq('id', data.contact_id)
          .single(),
      ])
      if (!orgSms || !contactSms) {
        // Without these the helper can't gate-check — leave an
        // observable breadcrumb (no PHI) so a missing-org or
        // hard-deleted-contact race surfaces in logs instead of
        // disappearing as a silent skip.
        console.error('[public-booking confirmation sms] precondition fetch returned null')
        return
      }
      await sendConsultationSms({
        type: 'confirmation',
        org: orgSms as any,
        contact: contactSms,
        consultation: {
          id: data.id,
          organization_id: data.organization_id,
          scheduled_at: data.scheduled_at,
        },
      })
    } catch {
      // Scrub: never log raw err here — public path could surface PHI
      // (phone/name) through it. The send helper already writes a
      // skipped/failed row to sms_log; that's the audit trail.
      console.error('[public-booking confirmation sms] failed')
    }
  })

  after(async () => {
    try {
      await notifyOwnerOfBooking({
        organizationId: data.organization_id,
        consultationId: data.id,
        scheduledAtIso: data.scheduled_at,
      })
    } catch {
      console.error('[public-booking owner notification] failed')
    }
  })

  // Move the contact to "lead → booked" stage if the org has it.
  // Safe to fail silently — the row is already a real consultation.
  try {
    const { data: stage } = await supabaseAdmin
      .from('pipeline_stages')
      .select('id')
      .eq('organization_id', data.organization_id)
      .eq('label', 'Consultation Booked')
      .maybeSingle()
    if (stage) {
      await supabaseAdmin
        .from('contacts')
        .update({ stage_id: stage.id, last_contacted_at: nowIso })
        .eq('id', data.contact_id)
        .eq('organization_id', data.organization_id)
    }
  } catch {
    // Pipeline-stage move is best-effort; the consultation row is the
    // source of truth and is already saved.
  }

  return NextResponse.json({
    ok: true,
    consultation_id: data.id,
    scheduled_at:    data.scheduled_at,
    duration_min:    data.duration_min,
  })
}
