import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendEmail } from '@/lib/resend'
import { withCronLock } from '@/lib/cron-locks'
import { getOrgOwner } from '@/lib/org-owner'
// Shared branded building blocks — extracted to email/branded.ts so the
// welcome email + weekly digest render identically to these reminders.
import { APP_URL, wrap as wrapBase, p, btn } from '@/lib/email/branded'

const wrap = (content: string) =>
  wrapBase(content, "Tarhunna &middot; You're receiving this because your account is on a free trial.")

// ── Email content ─────────────────────────────────────────────

function email7d(firstName: string, orgName: string) {
  return {
    subject: `How's your Tarhunna trial going, ${firstName}?`,
    html: wrap(`
      ${p(`Hi ${firstName},`)}
      ${p(`You're one week into your Tarhunna trial for <strong>${orgName}</strong>. Nice work getting started.`)}
      ${p(`Here's what you have access to:`)}
      <ul style="margin:0 0 16px 0;padding-left:20px;color:#374151;font-size:15px;line-height:1.8;">
        <li>Lead capture forms to collect new inquiries automatically</li>
        <li>CRM &amp; pipeline to track every lead from first contact to booked procedure</li>
        <li>Consultation scheduling and automated reminders</li>
        <li>Email automations that follow up on autopilot</li>
      </ul>
      ${p(`You have 7 days left on your trial. Subscribe anytime to keep full access.`)}
      <p style="margin:24px 0 8px 0;">${btn('Go to your dashboard', `${APP_URL}/dashboard`)}</p>
      <p style="margin:8px 0 0 0;">${btn('Subscribe now', `${APP_URL}/settings`)}</p>
    `),
  }
}

function email3d(firstName: string, orgName: string) {
  return {
    subject: `Your Tarhunna trial ends in 3 days`,
    html: wrap(`
      ${p(`Hi ${firstName},`)}
      ${p(`Your 14-day free trial for <strong>${orgName}</strong> ends in 3 days.`)}
      ${p(`After that, you won't be able to access your leads, pipeline, consultations, or automations without an active subscription. Subscribe now to keep everything running without interruption.`)}
      <p style="margin:24px 0 0 0;">${btn('Subscribe now — $297/month', `${APP_URL}/settings`)}</p>
      ${p(`<span style="font-size:13px;color:#6b7280;margin-top:16px;display:block;">Questions before subscribing? Just reply to this email.</span>`)}
    `),
  }
}

function email1d(firstName: string, orgName: string) {
  return {
    subject: `Last chance — your Tarhunna trial ends tomorrow`,
    html: wrap(`
      ${p(`Hi ${firstName},`)}
      ${p(`Your Tarhunna trial for <strong>${orgName}</strong> expires tomorrow.`)}
      ${p(`Once it ends, your account will be restricted until you subscribe. Don't lose access to your leads and pipeline.`)}
      <p style="margin:24px 0 0 0;">${btn('Subscribe before you lose access', `${APP_URL}/settings`, '#dc2626')}</p>
    `),
  }
}

function emailExpired(firstName: string, orgName: string) {
  return {
    subject: `Your Tarhunna trial has ended`,
    html: wrap(`
      ${p(`Hi ${firstName},`)}
      ${p(`Your 14-day trial for <strong>${orgName}</strong> has ended and your account is now restricted.`)}
      ${p(`Subscribe to restore full access to your leads, pipeline, consultations, and automations. Your data is safe — nothing has been deleted.`)}
      <p style="margin:24px 0 0 0;">${btn('Restore full access', `${APP_URL}/settings`, '#dc2626')}</p>
    `),
  }
}

// ── Send helper ───────────────────────────────────────────────

async function sendBatch(
  orgs: { id: string; name: string }[],
  buildEmail: (firstName: string, orgName: string) => { subject: string; html: string },
  sentAtColumn: string,
) {
  for (const org of orgs) {
    try {
      // Shared helper (org-owner.ts): the old maybeSingle() here broke
      // silently on two-owner orgs — no reminder emails, forever.
      const owner = await getOrgOwner(org.id)
      if (!owner) continue

      // Claim the reminder atomically (audit M4): only the tick that flips
      // the sent-at column from NULL wins. A racing/overlapping tick's
      // conditional UPDATE matches 0 rows and skips, so the email is sent
      // exactly once — replacing the old "SELECT null → send → stamp"
      // sequence that let two ticks both send.
      const claimIso = new Date().toISOString()
      const { data: claimed } = await supabaseAdmin
        .from('organizations')
        .update({ [sentAtColumn]: claimIso, updated_at: claimIso })
        .eq('id', org.id)
        .is(sentAtColumn, null)
        .select('id')
        .maybeSingle()
      if (!claimed) continue

      const firstName = (owner.full_name ?? '').split(' ')[0] || 'there'
      const { subject, html } = buildEmail(firstName, org.name)

      try {
        // Deterministic key: any accidental re-send inside Resend's 24h
        // dedup window collapses instead of double-emailing the owner.
        await sendEmail({ to: owner.email, subject, html, idempotencyKey: `trial:${sentAtColumn}:${org.id}` })
      } catch (sendErr) {
        // Release the claim so a later tick retries the send; the
        // deterministic key keeps that retry from duplicating.
        await supabaseAdmin
          .from('organizations')
          .update({ [sentAtColumn]: null })
          .eq('id', org.id)
          .eq(sentAtColumn, claimIso)
        throw sendErr
      }

    } catch (err: any) {
      console.error(`[trial-reminders] Failed for org ${org.id} (${sentAtColumn}):`, err.message)
    }
  }
}

// ── Main export ───────────────────────────────────────────────

export async function sendTrialReminders() {
  // Audit M4: this runs on the every-minute /api/cron. Serialize it with a
  // cron lock so two overlapping ticks can't both send (the per-org CAS in
  // sendBatch is the durable guard; the lock is the cheap stopgap).
  return withCronLock('sendTrialReminders', 90, async () => {
  const now     = new Date()
  const in7Days = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  const in3Days = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
  const in1Day  = new Date(Date.now() + 1 * 24 * 60 * 60 * 1000)

  // 7-day reminder: trial ends in ≤7 days but hasn't expired yet
  const { data: orgs7d } = await supabaseAdmin
    .from('organizations')
    .select('id, name')
    .eq('plan_status', 'trial')
    .is('trial_reminder_7d_sent_at', null)
    .lte('trial_ends_at', in7Days.toISOString())
    .gt('trial_ends_at', now.toISOString())

  // 3-day reminder
  const { data: orgs3d } = await supabaseAdmin
    .from('organizations')
    .select('id, name')
    .eq('plan_status', 'trial')
    .is('trial_reminder_3d_sent_at', null)
    .lte('trial_ends_at', in3Days.toISOString())
    .gt('trial_ends_at', now.toISOString())

  // 1-day reminder
  const { data: orgs1d } = await supabaseAdmin
    .from('organizations')
    .select('id, name')
    .eq('plan_status', 'trial')
    .is('trial_reminder_1d_sent_at', null)
    .lte('trial_ends_at', in1Day.toISOString())
    .gt('trial_ends_at', now.toISOString())

  // Expired: trial_ends_at has passed, plan is still trial or trial_expired
  const { data: orgsExpired } = await supabaseAdmin
    .from('organizations')
    .select('id, name')
    .in('plan_status', ['trial', 'trial_expired'])
    .is('trial_expired_email_sent_at', null)
    .lte('trial_ends_at', now.toISOString())

  await Promise.all([
    sendBatch(orgs7d     ?? [], email7d,       'trial_reminder_7d_sent_at'),
    sendBatch(orgs3d     ?? [], email3d,       'trial_reminder_3d_sent_at'),
    sendBatch(orgs1d     ?? [], email1d,       'trial_reminder_1d_sent_at'),
    sendBatch(orgsExpired ?? [], emailExpired, 'trial_expired_email_sent_at'),
  ])
  })
}
