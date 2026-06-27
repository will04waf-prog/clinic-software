/**
 * Internal hold-confirmation logic — Phase 5 hardening.
 *
 * Mirror of hold-impl.ts for the confirm side. The original
 * /api/booking/confirm route did rate-limit + JSON parse + the
 * atomic UPDATE + activity_log audit + manage-token sign + three
 * after()-scheduled side effects (SMS, owner email, automation
 * enqueue) + pipeline-stage move all in one place. The voice
 * receptionist tool /api/voice/tool/confirm called that route over
 * the network, which put it on the same per-IP rate-limit bucket as
 * every other Vapi caller fleet-wide.
 *
 * Lifting the work into this in-process helper lets the voice route
 * call confirmBookingInternal() directly, skipping the IP rate limit
 * (voice is gated upstream — Vapi assistant minutes + the caller is
 * on the line). The public HTTP route still rate-limits the same way
 * it always did; it just calls the helper after consume() instead of
 * doing the work itself.
 *
 * The after()-scheduled side effects live INSIDE this helper. Because
 * both callers are Next.js route handlers, `after()` from
 * `next/server` registers the callback against the active request's
 * AsyncLocalStorage and runs it after the response flushes — this
 * propagates fine across the impl boundary. Centralizing the side
 * effects here means a future caller (e.g. an internal admin "confirm
 * for the patient" button) gets the SMS + owner email + automations
 * for free, instead of silently dropping them.
 */

import { after } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendConsultationSms } from '@/lib/consultation-reminders'
import { notifyOwnerOfBooking } from '@/lib/booking/owner-notification'
import { signManageToken } from '@/lib/booking/manage-token'
import { enqueueEnrollment } from '@/lib/enrollment-jobs'
import { getAppUrl } from '@/lib/voice-agent/app-url'

export const confirmInputSchema = z.object({
  consultation_id: z.string().uuid(),
  hold_token:      z.string().uuid(),
})
export type ConfirmInput = z.infer<typeof confirmInputSchema>

/**
 * Closed enum of failure modes:
 *   - 'invalid_args'              → 400 / structured tool error
 *   - 'hold_expired_or_invalid'   → 410 / {booked:false, reason}
 *   - 'confirm_failed'            → 500 / {booked:false, reason}
 */
export type ConfirmReason =
  | 'invalid_args'
  | 'hold_expired_or_invalid'
  | 'confirm_failed'

export type ConfirmResult =
  | {
      ok: true
      consultation_id: string
      scheduled_at:    string
      duration_min:    number
      /** Clinic IANA zone — both callers can use this to format a
       *  "Tuesday at 2 PM" spoken string for the voice agent or a
       *  display string for the web flow. Pulled from
       *  organizations.timezone. Falls back to 'America/New_York'
       *  when the row is missing the column (shouldn't happen — the
       *  column is NOT NULL — but defensive). */
      timezone:        string
    }
  | { ok: false; reason: ConfirmReason; message?: string }

export async function confirmBookingInternal(rawInput: unknown): Promise<ConfirmResult> {
  const parsed = confirmInputSchema.safeParse(rawInput)
  if (!parsed.success) {
    return { ok: false, reason: 'invalid_args', message: parsed.error.issues[0].message }
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
    return { ok: false, reason: 'confirm_failed', message: error.message }
  }
  if (!data) {
    // Hold expired, the token doesn't match, the row was already
    // confirmed, or the cron canceled it.
    return { ok: false, reason: 'hold_expired_or_invalid' }
  }

  // Grab the timezone for the spoken-time formatter. Cheap one-row
  // lookup; we need it on the synchronous response anyway, AND the
  // after() SMS dispatch refetches a broader org row for SMS-gating
  // fields (we don't merge the two queries because the gating row
  // includes consent fields that aren't needed here).
  const { data: orgRow } = await supabaseAdmin
    .from('organizations')
    .select('timezone')
    .eq('id', data.organization_id)
    .maybeSingle()
  const timezone = (orgRow?.timezone as string | null) || 'America/New_York'

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

  // ── close the booking loop ──────────────────────────────────────
  // Patient gets a confirmation SMS containing a /manage/[token] link
  // (W5 — self-reschedule/cancel); owner gets an email; the org's
  // "consultation_booked" automations are enqueued. All three run via
  // `after()` so the serverless runtime keeps the function alive
  // until they finish — a bare detached promise would be guillotined
  // when the response flushes, silently dropping the work. The
  // caller already sees "you're booked" client-side or hears it from
  // the voice agent, so we never want to block the 200 on Twilio/
  // Resend latency either.
  //
  // Generate the manage token ONCE here, synchronously, so all three
  // detached tasks share the same value (and so token generation —
  // which can throw if MANAGE_TOKEN_SECRET is unset — surfaces before
  // we return success; a missing secret in prod is a configuration
  // bug worth seeing in logs).
  //
  // App URL comes from getAppUrl() which fail-closes in production
  // when NEXT_PUBLIC_APP_URL is unset — don't reintroduce the old
  // 'https://tarhunna.net' fallback here (a staging deploy with
  // missing env would have minted prod-domain manage links).
  let manageUrl: string | null = null
  try {
    const token = signManageToken(data.id)
    const appUrl = getAppUrl()
    manageUrl = `${appUrl}/manage/${token}`
  } catch (err) {
    // Don't fail the booking on a missing secret — the patient still
    // gets a 200 and the dashboard still sees the row. The SMS just
    // ships without a manage link, and a log line surfaces the
    // misconfiguration. Falls back gracefully because manage_url is
    // an optional template placeholder.
    console.error('[booking/confirm manage token] failed to sign:', err instanceof Error ? err.message : 'unknown')
  }

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
        console.error('[booking/confirm sms] precondition fetch returned null')
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
        manageUrl,
      })
    } catch {
      // Scrub: never log raw err here — public path could surface PHI
      // (phone/name) through it. The send helper already writes a
      // skipped/failed row to sms_log; that's the audit trail.
      console.error('[booking/confirm sms] failed')
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
      console.error('[booking/confirm owner notification] failed')
    }
  })

  // Automation parity with manual bookings. /api/consultations/route.ts
  // enqueues this trigger when staff create a booking. Public + voice
  // bookings get the same: any "consultation_booked" sequence the org
  // configured fires for all creation paths.
  after(async () => {
    try {
      await enqueueEnrollment({
        contactId:      data.contact_id,
        organizationId: data.organization_id,
        triggerType:    'consultation_booked',
      })
    } catch {
      // enqueueEnrollment already logs internally; swallow here so a
      // queue hiccup doesn't surface a console.error twice.
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

  return {
    ok: true,
    consultation_id: data.id as string,
    scheduled_at:    data.scheduled_at as string,
    duration_min:    data.duration_min as number,
    timezone,
  }
}

/**
 * Format an ISO timestamp into a human-readable phrase in the clinic
 * timezone. Used by the voice tool to give Layla a "spoken" string to
 * read back ("Tuesday, March 18 at 2:00 PM") instead of dictating raw
 * ISO. Matches the formatter used by lookup_my_appointments and
 * reschedule_appointment for parity.
 */
export function formatSpokenTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz || 'America/New_York',
    weekday:  'long',
    month:    'long',
    day:      'numeric',
    hour:     'numeric',
    minute:   '2-digit',
    hour12:   true,
  }).format(new Date(iso))
}
