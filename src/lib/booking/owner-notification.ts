/**
 * Phase 4 W4 — owner gets an email when a patient books publicly.
 *
 * Why email instead of SMS:
 *   - Owner phone isn't a populated, verified column today; adding it
 *     requires a verification flow + STOP-keyword collision with the
 *     contacts opt-out webhook.
 *   - Email is plan-agnostic, cheap, and the trial-reminders pattern
 *     already proves the wiring.
 *
 * The email body intentionally carries NO PHI — no patient name, no
 * phone, no specific time. Just "you got a booking — open the app to
 * see it." This sidesteps email-deliverability + carrier-relay PHI
 * concerns and keeps the alert lightweight.
 *
 * Idempotency: keyed by consultation_id so a retry of the confirm
 * route (or a worker retry of the IIFE) never sends twice. We ALSO
 * write an activity_log row with action='owner_notified_booking' and
 * check it before sending — that's the durable dedupe; Resend's
 * 24h idempotencyKey is the carrier-level dedupe.
 */

import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendEmail, wrapEmailHtml } from '@/lib/resend'

const PUBLIC_APP_URL =
  process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? 'https://tarhunna.net'

export interface NotifyOwnerArgs {
  organizationId: string
  consultationId: string
  /** ISO 8601 UTC instant the consultation is scheduled for. */
  scheduledAtIso: string
}

/**
 * Send a one-shot "new booking" alert to the org's owner. Safe to
 * call multiple times — the activity_log dedupe row + Resend's
 * idempotencyKey both guard against duplicate delivery.
 *
 * Never throws on missing config (no RESEND_API_KEY, no owner row,
 * no org.name). Returns silently. The caller is a fire-and-forget
 * IIFE that should not block the HTTP response.
 */
export async function notifyOwnerOfBooking(args: NotifyOwnerArgs): Promise<void> {
  // ── Short-circuit if email isn't configured. Saves 2-3 DB
  // round-trips in preview / dev / unconfigured envs. ──
  if (!process.env.RESEND_API_KEY) return

  // ── Dedupe: have we already notified for this consultation? ──
  // activity_log is checked-then-written; a true concurrent retry
  // could double-send between the SELECT and INSERT below, but the
  // hot path here is "single confirm-route call, retried only on
  // worker restart" — that retry would be seconds later, well after
  // our INSERT. Resend's idempotencyKey is the safety net.
  const { data: priorNotice } = await supabaseAdmin
    .from('activity_log')
    .select('id')
    .eq('organization_id', args.organizationId)
    .eq('action', 'owner_notified_booking')
    .contains('metadata', { consultation_id: args.consultationId })
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

  // ── Send. Body carries NO PHI: not the patient name, phone, or
  // specific scheduled_at. The owner opens the dashboard to see those. ──
  const subject = `New booking at ${orgName}`
  // /consultations is the right landing surface — that's where the
  // owner sees the booking row. /dashboard is a higher-level view
  // that requires a second click. Route group parens are stripped
  // from URLs, so this resolves to /<route-group>/consultations.
  const consultationsUrl = `${PUBLIC_APP_URL}/consultations`
  const html = wrapEmailHtml(
    [
      'You just got a new booking through your public booking page.',
      `Open ClinIQ to see the details: ${consultationsUrl}`,
    ].join('\n'),
    orgName,
  )

  try {
    await sendEmail({
      to: owner.email,
      subject,
      html,
      idempotencyKey: `owner-booking:${args.consultationId}`,
    })
  } catch {
    // Email body carries no PHI, so a log line here is safe. Without
    // this the failure mode is completely silent — no sms_log
    // equivalent for owner email exists.
    console.error('[owner-notification] resend send failed')
    return
  }

  // ── Durable dedupe row. Even if the next call beats Resend's
  // 24h dedup window (e.g. someone manually retries 25h later), the
  // activity_log check above will catch it. ──
  await supabaseAdmin.from('activity_log').insert({
    organization_id: args.organizationId,
    action:          'owner_notified_booking',
    metadata: {
      consultation_id: args.consultationId,
      scheduled_at:    args.scheduledAtIso,
    },
  })
}
