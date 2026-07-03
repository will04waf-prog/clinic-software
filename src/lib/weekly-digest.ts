/**
 * Weekly "Layla's impact" digest — the Monday-morning email that puts
 * last week's value (calls answered, bookings, booked revenue, new
 * leads) in the owner's inbox. Owners who never open the app churn
 * silently; this is the recurring proof-of-value that reaches them
 * anyway. Numbers come from the SAME aggregator as the dashboard's
 * ROI section (layla-impact-agg.ts), so email and app never disagree.
 *
 * Send rules:
 *   - weekly_digest_enabled must be true (org-level opt-out column).
 *   - Blocked orgs (canceled / suspended / lapsed trial) are skipped —
 *     no marketing-ish mail to locked-out accounts.
 *   - Zero-activity weeks are skipped: "Layla did nothing" is a churn
 *     email, not a retention email. The claim is still consumed, so
 *     the org is simply re-evaluated next Monday.
 *   - Per-org CAS claim on weekly_digest_last_sent_at (only wins if
 *     NULL or older than 6 days) + deterministic Resend idempotency
 *     key — same exactly-once pattern as trial-reminders.
 */

import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendEmail, escapeHtml } from '@/lib/resend'
import { withCronLock } from '@/lib/cron-locks'
import { blockedReason } from '@/lib/billing/org-access'
import { aggregateLaylaImpact, type LaylaImpactAgg } from '@/lib/analytics/layla-impact-agg'
import { APP_URL, wrap, p, btn, statRow } from '@/lib/email/branded'
import { getOrgOwner } from '@/lib/org-owner'

const money = (cents: number) => `$${Math.round(cents / 100).toLocaleString()}`
const plural = (n: number, s: string) => `${n} ${s}${n === 1 ? '' : 's'}`

export function buildDigestEmail(
  orgName: string,
  firstName: string,
  agg: LaylaImpactAgg,
  newContacts: number,
) {
  // Subjects lead with the best number we actually have — never
  // "$0 booked across 0 consultations" (a churn email, not a
  // retention email). Leads-only weeks celebrate the leads.
  const subject =
    agg.callsAnswered > 0
      ? `${orgName} last week: ${plural(agg.callsAnswered, 'call')} answered, ${money(agg.bookingRevenueCents)} booked`
      : agg.bookingsInRange > 0
        ? `${orgName} last week: ${money(agg.bookingRevenueCents)} booked across ${plural(agg.bookingsInRange, 'consultation')}`
        : `${orgName} last week: ${plural(newContacts, 'new lead')} captured`

  // Escape everything owner-typed before it touches HTML (the
  // subject stays raw — it's plain text).
  const safeOrg = escapeHtml(orgName)
  const safeFirst = escapeHtml(firstName)

  const rows = [
    agg.callsAnswered > 0
      ? statRow('Calls Layla answered', String(agg.callsAnswered),
          `${plural(agg.messagesCaptured, 'message')} taken · ${agg.transferredToStaff} transferred to you`)
      : '',
    agg.bookingsInRange > 0
      ? statRow('Booked value', money(agg.bookingRevenueCents), `${plural(agg.bookingsInRange, 'consultation')} booked`)
      : '',
    agg.laylaAssistedBookings > 0
      ? statRow('Booked after a Layla call', String(agg.laylaAssistedBookings),
          `${money(agg.laylaAssistedRevenueCents)} from callers she spoke with`)
      : '',
    agg.reminderCallsPlaced > 0
      ? statRow('Reminder calls placed', String(agg.reminderCallsPlaced))
      : '',
    newContacts > 0 ? statRow('New leads captured', String(newContacts)) : '',
  ].filter(Boolean).join('')

  const html = wrap(`
    ${p(`Hi ${safeFirst},`)}
    ${p(`Here's what happened at <strong>${safeOrg}</strong> over the last 7 days:`)}
    <table style="width:100%;border-collapse:collapse;margin:0 0 20px 0;">${rows}</table>
    <p style="margin:24px 0 0 0;">${btn('See the full breakdown', `${APP_URL}/dashboard#performance`)}</p>
    ${p(`<span style="font-size:12px;color:#9ca3af;margin-top:16px;display:block;">These numbers cover the last 7 days; your dashboard defaults to a 30-day view.</span>`)}
  `, "Tarhunna &middot; Your weekly summary. Want it off? Just reply and tell us.")

  return { subject, html }
}

export interface DigestOutcome {
  ok: boolean
  considered: number
  sent: number
  skippedNoActivity: number
  skippedBlocked: number
  errors: number
}

export async function sendWeeklyDigests(): Promise<DigestOutcome> {
  const outcome: DigestOutcome = { ok: true, considered: 0, sent: 0, skippedNoActivity: 0, skippedBlocked: 0, errors: 0 }

  await withCronLock('weeklyDigest', 300, async () => {
    const now = new Date()
    const startIso = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const sixDaysAgoIso = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString()

    const { data: orgs, error } = await supabaseAdmin
      .from('organizations')
      .select('id, name, plan_status, trial_ends_at, weekly_digest_last_sent_at')
      .eq('weekly_digest_enabled', true)
    if (error) {
      console.error('[weekly-digest] org fetch failed:', error.message)
      outcome.ok = false
      return
    }

    for (const org of orgs ?? []) {
      outcome.considered++
      try {
        if (blockedReason(org.plan_status, org.trial_ends_at)) {
          outcome.skippedBlocked++
          continue
        }

        // CAS claim: only the tick that moves last_sent_at forward wins.
        // 6-day threshold (not 7) so minor cron-start jitter week to
        // week can't make Mondays alternately skip.
        const claimIso = now.toISOString()
        const prev = org.weekly_digest_last_sent_at as string | null
        const { data: claimed } = await supabaseAdmin
          .from('organizations')
          .update({ weekly_digest_last_sent_at: claimIso })
          .eq('id', org.id)
          .or(`weekly_digest_last_sent_at.is.null,weekly_digest_last_sent_at.lt.${sixDaysAgoIso}`)
          .select('id')
          .maybeSingle()
        if (!claimed) continue

        const release = async () => {
          await supabaseAdmin
            .from('organizations')
            .update({ weekly_digest_last_sent_at: prev })
            .eq('id', org.id)
            .eq('weekly_digest_last_sent_at', claimIso)
        }

        try {
          const [owner, consultsRes, callsRes, contactsRes] = await Promise.all([
            getOrgOwner(org.id),
            supabaseAdmin.from('consultations')
              .select('contact_id, status, service:services(price_cents)')
              .eq('organization_id', org.id).gte('created_at', startIso),
            supabaseAdmin.from('call_logs')
              .select('direction, outcome, contact_id')
              .eq('organization_id', org.id).gte('started_at', startIso),
            supabaseAdmin.from('contacts')
              .select('*', { count: 'exact', head: true })
              .eq('organization_id', org.id).gte('created_at', startIso),
          ])

          if (!owner) { await release(); continue }

          const agg = aggregateLaylaImpact(consultsRes.data ?? [], callsRes.data ?? [])
          const newContacts = contactsRes.count ?? 0

          if (agg.callsAnswered === 0 && agg.bookingsInRange === 0 && newContacts === 0) {
            // Nothing to celebrate — skip the send but KEEP the claim so
            // this org isn't re-evaluated until next week.
            outcome.skippedNoActivity++
            continue
          }

          const firstName = (owner.full_name ?? '').split(' ')[0] || 'there'
          const { subject, html } = buildDigestEmail(org.name, firstName, agg, newContacts)

          await sendEmail({
            to: owner.email,
            subject,
            html,
            idempotencyKey: `digest:${org.id}:${claimIso.slice(0, 10)}`,
          })
          outcome.sent++
        } catch (err) {
          await release()
          throw err
        }
      } catch (err) {
        outcome.errors++
        outcome.ok = false
        console.error(`[weekly-digest] failed for org ${org.id}:`, err instanceof Error ? err.message : err)
      }
    }
  })

  return outcome
}
