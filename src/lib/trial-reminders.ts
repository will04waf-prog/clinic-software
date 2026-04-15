import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendEmail } from '@/lib/resend'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://tarhunna.net'

// ── HTML helpers ──────────────────────────────────────────────

function wrap(content: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/></head>
<body style="font-family:system-ui,-apple-system,sans-serif;background:#f9fafb;margin:0;padding:40px 20px;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:40px;box-shadow:0 1px 3px rgba(0,0,0,.08);">
    <div style="margin-bottom:28px;">
      <div style="display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;background:#4f46e5;border-radius:8px;">
        <span style="color:#fff;font-size:18px;font-weight:900;">T</span>
      </div>
    </div>
    ${content}
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:32px 0 16px;"/>
    <p style="font-size:12px;color:#9ca3af;margin:0;">Tarhunna &middot; You're receiving this because your account is on a free trial.</p>
  </div>
</body>
</html>`
}

const p = (t: string) =>
  `<p style="margin:0 0 16px 0;line-height:1.7;color:#374151;font-size:15px;">${t}</p>`

const btn = (text: string, href: string, color = '#4f46e5') =>
  `<a href="${href}" style="display:inline-block;background:${color};color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:14px;">${text}</a>`

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
      <p style="margin:8px 0 0 0;">${btn('Subscribe now', `${APP_URL}/settings`, '#111827')}</p>
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
      const { data: owner } = await supabaseAdmin
        .from('profiles')
        .select('email, full_name')
        .eq('organization_id', org.id)
        .eq('role', 'owner')
        .maybeSingle()

      if (!owner?.email) continue

      const firstName = (owner.full_name ?? '').split(' ')[0] || 'there'
      const { subject, html } = buildEmail(firstName, org.name)

      await sendEmail({ to: owner.email, subject, html })

      await supabaseAdmin
        .from('organizations')
        .update({ [sentAtColumn]: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', org.id)

    } catch (err: any) {
      console.error(`[trial-reminders] Failed for org ${org.id} (${sentAtColumn}):`, err.message)
    }
  }
}

// ── Main export ───────────────────────────────────────────────

export async function sendTrialReminders() {
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
}
