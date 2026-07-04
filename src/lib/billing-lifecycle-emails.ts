/**
 * Billing lifecycle emails — dunning, cancellation, and win-back.
 * The last hole in the revenue loop: before this existed, a failed
 * card charge, a cancellation, and a lapsed trial all went silent
 * after the moment they happened.
 *
 *   - Payment failed  → email per Stripe retry attempt (webhook-driven;
 *     idempotency key embeds invoice id + attempt, so Stripe webhook
 *     redeliveries can't double-send but each REAL retry re-emails).
 *   - Canceled        → immediate "subscription ended" email (webhook).
 *   - Trial win-back  → 7 days after trial_expired, one email, CAS-
 *     claimed on trial_winback_sent_at (cron sweep).
 *   - Churn win-back  → 14 days after canceled_at, one email, CAS-
 *     claimed on winback_sent_at (cron sweep).
 *
 * Webhook-called functions NEVER throw — a Resend hiccup must not
 * 500 the Stripe webhook (Stripe would retry the whole event and
 * re-run unrelated handlers).
 */

import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendEmail, escapeHtml } from '@/lib/resend'
import { withCronLock } from '@/lib/cron-locks'
import { getOrgOwner } from '@/lib/org-owner'
import { APP_URL, wrap as wrapBase, p, btn } from '@/lib/email/branded'

const wrap = (content: string) =>
  wrapBase(content, 'Tarhunna &middot; Billing notification for your clinic account.')

function firstNameOf(fullName: string | null): string {
  return (fullName ?? '').split(' ')[0] || 'there'
}

async function orgBySubscription(subId: string) {
  const { data } = await supabaseAdmin
    .from('organizations')
    .select('id, name, plan')
    .eq('stripe_subscription_id', subId)
    .maybeSingle()
  return data
}

// ── Dunning ──────────────────────────────────────────────────────

export async function sendPaymentFailedEmail(
  subId: string,
  invoice: { id: string; attempt: number },
): Promise<void> {
  try {
    const org = await orgBySubscription(subId)
    if (!org) return
    const owner = await getOrgOwner(org.id)
    if (!owner) return

    const first = escapeHtml(firstNameOf(owner.full_name))
    const orgName = escapeHtml(org.name)
    const firstAttempt = invoice.attempt <= 1

    const subject = firstAttempt
      ? `Your Tarhunna payment didn't go through`
      : `Still can't process your Tarhunna payment`

    const html = wrap(firstAttempt
      ? `
        ${p(`Hi ${first},`)}
        ${p(`We tried to charge the card on file for <strong>${orgName}</strong> and it didn't go through. This happens — expired cards, new numbers, bank hiccups.`)}
        ${p(`Nothing is interrupted yet, and your card will be retried automatically. Updating it takes about a minute:`)}
        <p style="margin:24px 0 0 0;">${btn('Update payment method', `${APP_URL}/settings`)}</p>`
      : `
        ${p(`Hi ${first},`)}
        ${p(`We've now tried the card on file for <strong>${orgName}</strong> more than once without success. After a few more attempts, the subscription will be canceled automatically and your clinic will lose access — including Layla, reminders, and texting.`)}
        ${p(`One minute fixes it:`)}
        <p style="margin:24px 0 0 0;">${btn('Update payment method', `${APP_URL}/settings`, '#dc2626')}</p>`)

    await sendEmail({
      to: owner.email,
      subject,
      html,
      // One email per REAL retry attempt; Stripe webhook redeliveries
      // of the same attempt collapse on this key.
      idempotencyKey: `dunning:${invoice.id}:${invoice.attempt}`,
    })
  } catch (err) {
    console.error('[billing-lifecycle] payment-failed email error:', err instanceof Error ? err.message : err)
  }
}

// ── Cancellation ─────────────────────────────────────────────────

export async function sendSubscriptionCanceledEmail(subId: string): Promise<void> {
  try {
    const org = await orgBySubscription(subId)
    if (!org) return
    const owner = await getOrgOwner(org.id)
    if (!owner) return

    const first = escapeHtml(firstNameOf(owner.full_name))
    const orgName = escapeHtml(org.name)

    const html = wrap(`
      ${p(`Hi ${first},`)}
      ${p(`Your Tarhunna subscription for <strong>${orgName}</strong> has ended. Layla has stopped answering, and reminders and texting are paused.`)}
      ${p(`Nothing has been deleted — your contacts, bookings, call history, and settings are all safe. Resubscribe any time and everything picks up exactly where it left off.`)}
      <p style="margin:24px 0 0 0;">${btn('Restore your clinic', `${APP_URL}/pricing`)}</p>
      ${p(`<span style="font-size:13px;color:#6b7280;margin-top:16px;display:block;">If this cancellation wasn't intentional (a failed card can end a subscription automatically), just reply — we'll sort it out.</span>`)}
    `)

    await sendEmail({
      to: owner.email,
      subject: `Your Tarhunna subscription has ended`,
      html,
      idempotencyKey: `sub-canceled:${subId}`,
    })
  } catch (err) {
    console.error('[billing-lifecycle] canceled email error:', err instanceof Error ? err.message : err)
  }
}

// ── Win-back sweeps (cron) ───────────────────────────────────────

const TRIAL_WINBACK_DELAY_DAYS = 7
const CHURN_WINBACK_DELAY_DAYS = 14

export async function sendWinbacks(): Promise<{ trial: number; churn: number }> {
  const outcome = { trial: 0, churn: 0 }

  await withCronLock('sendWinbacks', 90, async () => {
    const now = Date.now()

    // ── Trial win-back: expired 7+ days ago, never won-back ──
    const trialCutoff = new Date(now - TRIAL_WINBACK_DELAY_DAYS * 86_400_000).toISOString()
    const { data: trialOrgs } = await supabaseAdmin
      .from('organizations')
      .select('id, name')
      .eq('plan_status', 'trial_expired')
      .is('trial_winback_sent_at', null)
      .lt('trial_ends_at', trialCutoff)
      .limit(25)

    for (const org of trialOrgs ?? []) {
      let releaseOnError: (() => unknown) | null = null
      try {
        const claimIso = new Date().toISOString()
        const { data: claimed } = await supabaseAdmin
          .from('organizations')
          .update({ trial_winback_sent_at: claimIso })
          .eq('id', org.id)
          .is('trial_winback_sent_at', null)
          .select('id')
          .maybeSingle()
        if (!claimed) continue

        const release = () => supabaseAdmin
          .from('organizations')
          .update({ trial_winback_sent_at: null })
          .eq('id', org.id)
          .eq('trial_winback_sent_at', claimIso)
        releaseOnError = release

        const owner = await getOrgOwner(org.id)
        if (!owner) { await release(); continue }

        // Personalize with what their trial actually produced — a
        // clinic that saw activity gets its own numbers back.
        const [callsRes, contactsRes] = await Promise.all([
          supabaseAdmin.from('call_logs').select('*', { count: 'exact', head: true })
            .eq('organization_id', org.id).eq('direction', 'inbound'),
          supabaseAdmin.from('contacts').select('*', { count: 'exact', head: true })
            .eq('organization_id', org.id),
        ])
        const calls = callsRes.count ?? 0
        const contacts = contactsRes.count ?? 0
        const statLine = calls > 0
          ? `During your trial, Layla answered ${calls} call${calls === 1 ? '' : 's'} for you — that phone hasn't stopped ringing just because she did.`
          : contacts > 0
            ? `The ${contacts} contact${contacts === 1 ? '' : 's'} you brought in are still sitting in your pipeline, waiting.`
            : `Everything you set up is exactly where you left it.`

        const first = escapeHtml(firstNameOf(owner.full_name))
        const html = wrap(`
          ${p(`Hi ${first},`)}
          ${p(`It's been a week since your Tarhunna trial for <strong>${escapeHtml(org.name)}</strong> ended, so one honest check-in.`)}
          ${p(escapeHtml(statLine))}
          ${p(`Your setup, contacts, and history are all saved. Subscribing takes two minutes and everything switches back on — including Layla on your phone line.`)}
          <p style="margin:24px 0 0 0;">${btn('Pick up where you left off', `${APP_URL}/pricing`)}</p>
          ${p(`<span style="font-size:13px;color:#6b7280;margin-top:16px;display:block;">Questions, or want a hand getting set up? Just reply — I read these.</span>`)}
        `)

        try {
          await sendEmail({
            to: owner.email,
            subject: `Your clinic's setup is still here`,
            html,
            idempotencyKey: `trial-winback:${org.id}`,
          })
          outcome.trial++
        } catch (err) {
          await release()
          throw err
        }
      } catch (err) {
        // Unexpected throw between claim and send: give the claim back
        // so the org isn't silently excluded forever. CAS-guarded — if
        // the claim was already released (send-failure path), this
        // matches zero rows.
        if (releaseOnError) await Promise.resolve(releaseOnError()).catch(() => {})
        console.error(`[billing-lifecycle] trial win-back failed for org ${org.id}:`, err instanceof Error ? err.message : err)
      }
    }

    // ── Churn win-back: canceled 14+ days ago, never won-back ──
    const churnCutoff = new Date(now - CHURN_WINBACK_DELAY_DAYS * 86_400_000).toISOString()
    const { data: churnOrgs } = await supabaseAdmin
      .from('organizations')
      .select('id, name, canceled_at')
      .eq('plan_status', 'canceled')
      .is('winback_sent_at', null)
      .not('canceled_at', 'is', null)
      .lt('canceled_at', churnCutoff)
      .limit(25)

    for (const org of churnOrgs ?? []) {
      let releaseOnError: (() => unknown) | null = null
      try {
        const claimIso = new Date().toISOString()
        const { data: claimed } = await supabaseAdmin
          .from('organizations')
          .update({ winback_sent_at: claimIso })
          .eq('id', org.id)
          .is('winback_sent_at', null)
          .select('id')
          .maybeSingle()
        if (!claimed) continue

        const release = () => supabaseAdmin
          .from('organizations')
          .update({ winback_sent_at: null })
          .eq('id', org.id)
          .eq('winback_sent_at', claimIso)
        releaseOnError = release

        const owner = await getOrgOwner(org.id)
        if (!owner) { await release(); continue }

        const first = escapeHtml(firstNameOf(owner.full_name))
        const html = wrap(`
          ${p(`Hi ${first},`)}
          ${p(`Two weeks since <strong>${escapeHtml(org.name)}</strong> left Tarhunna — everything is still exactly where you left it: contacts, bookings, call history, your whole setup.`)}
          ${p(`If something about the product pushed you away, reply and tell me — I read every one of these, and it may already be fixed.`)}
          ${p(`And if it was just timing: two minutes and it's all back on.`)}
          <p style="margin:24px 0 0 0;">${btn('Turn it back on', `${APP_URL}/pricing`)}</p>
        `)

        try {
          await sendEmail({
            to: owner.email,
            subject: `Everything's where you left it`,
            html,
            idempotencyKey: `churn-winback:${org.id}:${String(org.canceled_at)}`,
          })
          outcome.churn++
        } catch (err) {
          await release()
          throw err
        }
      } catch (err) {
        if (releaseOnError) await Promise.resolve(releaseOnError()).catch(() => {})
        console.error(`[billing-lifecycle] churn win-back failed for org ${org.id}:`, err instanceof Error ? err.message : err)
      }
    }
  })

  return outcome
}
