/**
 * Phase 4 W4/W5 — owner gets an email when something happens to a
 * public booking. W4 ships the "new" kind; W5 adds 'rescheduled' and
 * 'canceled' (matching the consultations status spelling).
 *
 * Why email instead of SMS:
 *   - Owner phone isn't a populated, verified column today; adding it
 *     requires a verification flow + STOP-keyword collision with the
 *     contacts opt-out webhook.
 *   - Email is plan-agnostic, cheap, and the trial-reminders pattern
 *     already proves the wiring.
 *
 * The email body intentionally carries NO PHI — no patient name, no
 * phone, no specific time. Just "something changed on a booking —
 * open the app to see it." This sidesteps email-deliverability +
 * carrier-relay PHI concerns and keeps the alert lightweight.
 *
 * Idempotency: keyed by (consultation_id, kind) so the same booking
 * can fire one "new" + one "rescheduled" + one "canceled" email
 * without the dedupe rejecting later kinds. Within a single (id, kind)
 * pair we dedupe on the activity_log row + Resend's idempotencyKey.
 */

import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendEmail, wrapEmailHtml } from '@/lib/resend'

const PUBLIC_APP_URL =
  process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? 'https://tarhunna.net'

export type OwnerNotificationKind = 'new' | 'rescheduled' | 'canceled'

export interface NotifyOwnerArgs {
  organizationId: string
  consultationId: string
  /** ISO 8601 UTC instant the consultation is scheduled for. */
  scheduledAtIso: string
  /**
   * What changed. Default 'new' preserves W4 caller behavior.
   * Reschedule + cancel paths (W5) pass the appropriate kind so the
   * email subject and dedupe key reflect the lifecycle event.
   */
  kind?: OwnerNotificationKind
}

const ACTION_BY_KIND: Record<OwnerNotificationKind, string> = {
  new:         'owner_notified_booking',
  rescheduled: 'owner_notified_reschedule',
  canceled:    'owner_notified_cancel',
}

const SUBJECT_BY_KIND: Record<OwnerNotificationKind, (orgName: string) => string> = {
  new:         (n) => `New booking at ${n}`,
  rescheduled: (n) => `Booking rescheduled at ${n}`,
  canceled:    (n) => `Booking canceled at ${n}`,
}

const BODY_BY_KIND: Record<OwnerNotificationKind, string> = {
  new:         'You just got a new booking through your public booking page.',
  rescheduled: 'A patient just rescheduled their appointment through your booking page.',
  canceled:    'A patient just canceled their appointment through your booking page.',
}

/**
 * Send a one-shot lifecycle email to the org's owner. Safe to call
 * multiple times for the same (consultation_id, kind) pair — the
 * activity_log dedupe row + Resend's idempotencyKey both guard
 * against duplicate delivery.
 *
 * Never throws on missing config (no RESEND_API_KEY, no owner row,
 * no org.name). Returns silently. The caller is a fire-and-forget
 * after() callback that should not block the HTTP response.
 */
export async function notifyOwnerOfBooking(args: NotifyOwnerArgs): Promise<void> {
  // ── Short-circuit if email isn't configured. Saves 2-3 DB
  // round-trips in preview / dev / unconfigured envs. ──
  if (!process.env.RESEND_API_KEY) return

  const kind: OwnerNotificationKind = args.kind ?? 'new'
  const action = ACTION_BY_KIND[kind]

  // ── Dedupe: have we already notified for this (consultation, kind)?
  // 'rescheduled' uses a per-event disambiguator (the new scheduled_at)
  // so a patient who reschedules twice gets the owner notified twice —
  // owners need to see every change. 'new' + 'canceled' are once-per-
  // lifetime events for a given consultation_id so the consultation_id
  // alone is the right key. ──
  const dedupeMatch: Record<string, string> =
    kind === 'rescheduled'
      ? { consultation_id: args.consultationId, scheduled_at: args.scheduledAtIso }
      : { consultation_id: args.consultationId }
  const { data: priorNotice } = await supabaseAdmin
    .from('activity_log')
    .select('id')
    .eq('organization_id', args.organizationId)
    .eq('action', action)
    .contains('metadata', dedupeMatch)
    .limit(1)
    .maybeSingle()
  if (priorNotice) return

  // ── Lookup owner + org name. Owner is deterministic: oldest
  // `role=owner` profile in the org. Org name is for the subject. ──
  const [{ data: owner }, { data: org }] = await Promise.all([
    supabaseAdmin
      .from('profiles')
      .select('email, full_name')
      .eq('organization_id', args.organizationId)
      .eq('role', 'owner')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from('organizations')
      .select('name')
      .eq('id', args.organizationId)
      .single(),
  ])

  if (!owner?.email) return
  const orgName = org?.name ?? 'your clinic'

  // Deep-link to the calendar view directly so the owner lands on the
  // grid (W6) rather than the legacy list — they're tapping a "new
  // booking" email and visual context for the time slot is the point.
  const consultationsUrl = `${PUBLIC_APP_URL}/consultations?view=calendar`
  const html = wrapEmailHtml(
    [
      BODY_BY_KIND[kind],
      `Open ClinIQ to see the details: ${consultationsUrl}`,
    ].join('\n'),
    orgName,
  )

  try {
    await sendEmail({
      to: owner.email,
      subject: SUBJECT_BY_KIND[kind](orgName),
      html,
      // Disambiguator for 'rescheduled' so the 2nd-and-Nth reschedule
      // notifications get a fresh idempotencyKey (Resend would
      // otherwise dedup the second one within its 24h window).
      idempotencyKey: kind === 'rescheduled'
        ? `${action}:${args.consultationId}:${args.scheduledAtIso}`
        : `${action}:${args.consultationId}`,
    })
  } catch {
    // Email body carries no PHI, so a log line here is safe.
    console.error(`[owner-notification:${kind}] resend send failed`)
    return
  }

  // ── Durable dedupe row. Even if the next call beats Resend's
  // 24h dedup window, the activity_log check above will catch it. ──
  await supabaseAdmin.from('activity_log').insert({
    organization_id: args.organizationId,
    action,
    metadata: {
      consultation_id: args.consultationId,
      scheduled_at:    args.scheduledAtIso,
      kind,
    },
  })
}
