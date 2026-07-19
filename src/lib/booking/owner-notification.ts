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
import { getVerticalConfig, type VerticalTerms } from '@/lib/vertical/config'

const PUBLIC_APP_URL =
  process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? 'https://tarhunna.net'

export type OwnerNotificationKind = 'new' | 'rescheduled' | 'canceled' | 'confirmed'

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
  confirmed:   'owner_notified_confirm',
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * Multi-vertical Phase 2: subject + body driven by the tenant's terms
 * and owner_language. The customer noun ('A patient') and the scheduled-
 * thing noun ('their appointment' / 'Appointment confirmed') come from
 * terms.customer / terms.engagement — this surface's med-spa literal is
 * already 'appointment' (not 'consultation'), so terms.engagement is
 * byte-identical for med-spa and no consultation branch is needed. The
 * 'booking' wording is vertical-neutral and stays as-is. English output
 * for a med-spa tenant is byte-for-byte what it was before.
 */
function buildOwnerBookingEmail(
  kind: OwnerNotificationKind,
  orgName: string,
  terms: VerticalTerms,
  lang: 'en' | 'es',
): { subject: string; body: string } {
  const { customer, customerEs, engagement, engagementEs } = terms

  if (lang === 'es') {
    const subject: Record<OwnerNotificationKind, string> = {
      new:         `Nueva reserva en ${orgName}`,
      rescheduled: `Reserva reprogramada en ${orgName}`,
      canceled:    `Reserva cancelada en ${orgName}`,
      confirmed:   `Confirmación de ${engagementEs} en ${orgName}`,
    }
    const body: Record<OwnerNotificationKind, string> = {
      new:         'Acabas de recibir una nueva reserva a través de tu página de reservas pública.',
      rescheduled: `Un ${customerEs} acaba de reprogramar su ${engagementEs} a través de tu página de reservas.`,
      canceled:    `Un ${customerEs} acaba de cancelar su ${engagementEs} a través de tu página de reservas.`,
      confirmed:   `Un ${customerEs} acaba de confirmar su ${engagementEs} en la llamada de recordatorio con IA.`,
    }
    return { subject: subject[kind], body: body[kind] }
  }

  const subject: Record<OwnerNotificationKind, string> = {
    new:         `New booking at ${orgName}`,
    rescheduled: `Booking rescheduled at ${orgName}`,
    canceled:    `Booking canceled at ${orgName}`,
    confirmed:   `${cap(engagement)} confirmed at ${orgName}`,
  }
  const body: Record<OwnerNotificationKind, string> = {
    new:         'You just got a new booking through your public booking page.',
    rescheduled: `A ${customer} just rescheduled their ${engagement} through your booking page.`,
    canceled:    `A ${customer} just canceled their ${engagement} through your booking page.`,
    // 'confirmed' is fired by the outbound reminder-call flow when the
    // customer verbally confirms they're still coming. PHI-free copy —
    // mirrors the rest of this file.
    confirmed:   `A ${customer} just confirmed their upcoming ${engagement} on the AI reminder call.`,
  }
  return { subject: subject[kind], body: body[kind] }
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
      .select('name, vertical, owner_language')
      .eq('id', args.organizationId)
      .single(),
  ])

  if (!owner?.email) return
  // Multi-vertical Phase 2: owner-facing output follows owner_language,
  // and the terminology follows the tenant's vertical. Both default to
  // med-spa / English, so an existing med-spa tenant is byte-identical.
  const terms = getVerticalConfig(org?.vertical).terms
  const ownerLang: 'en' | 'es' = org?.owner_language === 'es' ? 'es' : 'en'
  const orgName = org?.name ?? (ownerLang === 'es' ? `tu ${terms.businessEs}` : `your ${terms.business}`)
  const { subject, body } = buildOwnerBookingEmail(kind, orgName, terms, ownerLang)

  // Deep-link to the calendar view directly so the owner lands on the
  // grid (W6) rather than the legacy list — they're tapping a "new
  // booking" email and visual context for the time slot is the point.
  const consultationsUrl = `${PUBLIC_APP_URL}/consultations?view=calendar`
  const html = wrapEmailHtml(
    [
      body,
      ownerLang === 'es'
        ? `Abre Tarhunna para ver los detalles: ${consultationsUrl}`
        : `Open Tarhunna to see the details: ${consultationsUrl}`,
    ].join('\n'),
    orgName,
  )

  try {
    await sendEmail({
      to: owner.email,
      subject,
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
