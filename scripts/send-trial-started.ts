/**
 * ONE-TIME send: "your trial is live" email to the orgs whose trials
 * were armed by the 2026-07-02 backfill (plan='trial',
 * plan_status='trial', no Stripe subscription). Those owners got a
 * fresh 14-day window but were never told — this is the announcement.
 *
 * Usage:
 *   npx tsx scripts/send-trial-started.ts                # DRY RUN — prints recipients + subject, sends nothing
 *   npx tsx scripts/send-trial-started.ts --send         # actually sends
 *   npx tsx scripts/send-trial-started.ts --send --exclude=a@x.com,b@y.com
 *
 * Safety: dry-run by default; per-org deterministic Resend idempotency
 * key (trial-started:<orgId>) so a double --send inside 24h collapses.
 */

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { config as loadEnv } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

for (const path of ['.env.local', '.env']) {
  const full = resolve(process.cwd(), path)
  if (existsSync(full)) loadEnv({ path: full })
}

async function main() {
  const send = process.argv.includes('--send')
  const excludeArg = process.argv.find(a => a.startsWith('--exclude='))
  const excluded = new Set(
    (excludeArg?.slice('--exclude='.length) ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
  )

  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required')
    process.exit(1)
  }

  // Deferred imports so dotenv above runs before modules read env.
  const { sendEmail, escapeHtml } = await import('../src/lib/resend')
  const { APP_URL, wrap, p, btn } = await import('../src/lib/email/branded')

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })

  const { data: orgs, error } = await supabase
    .from('organizations')
    .select('id, name, trial_ends_at, profiles!inner(email, full_name, role)')
    .eq('plan', 'trial')
    .eq('plan_status', 'trial')
    .is('stripe_subscription_id', null)
    // Only the orgs the 2026-07-02 backfill restarted. Without this
    // bound, running the script after new signups start arriving would
    // tell a brand-new owner their trial "got a fresh start" — wrong
    // copy, and their welcome email already covered day 0.
    .lt('created_at', '2026-07-02T00:00:00Z')
    .eq('profiles.role', 'owner')
  if (error) {
    console.error('Org fetch failed:', error.message)
    process.exit(1)
  }

  const targets = (orgs ?? [])
    .map((o: any) => {
      const owner = Array.isArray(o.profiles) ? o.profiles[0] : o.profiles
      return { id: o.id, name: (o.name as string).trim(), trialEndsAt: o.trial_ends_at, email: owner?.email as string | undefined, fullName: owner?.full_name as string | undefined }
    })
    .filter(t => t.email && !excluded.has(t.email.toLowerCase()))

  console.log(`\n${send ? 'SENDING to' : 'DRY RUN —'} ${targets.length} recipient(s):`)
  for (const t of targets) console.log(`  • ${t.name} — ${t.email} (trial ends ${String(t.trialEndsAt).slice(0, 10)})`)
  if (!send) {
    console.log('\nNothing sent. Re-run with --send to deliver.')
    return
  }

  let sent = 0
  for (const t of targets) {
    const firstName = escapeHtml((t.fullName ?? '').split(' ')[0] || 'there')
    const safeName = escapeHtml(t.name)
    const endsPretty = new Date(t.trialEndsAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
    const html = wrap(`
      ${p(`Hi ${firstName},`)}
      ${p(`Good news — your Tarhunna trial for <strong>${safeName}</strong> just got a fresh start: <strong>14 free days with everything unlocked</strong>, through <strong>${endsPretty}</strong>.`)}
      ${p(`A lot has shipped since you signed up:`)}
      <ul style="margin:0 0 16px 0;padding-left:20px;color:#374151;font-size:15px;line-height:1.9;">
        <li><strong>Layla, your AI receptionist</strong> — she answers your clinic's phone, talks to patients naturally, and books appointments on the call. Included in your trial.</li>
        <li><strong>A setup guide</strong> on your dashboard that walks you from zero to a bookable calendar in minutes</li>
        <li><strong>An impact report</strong> showing every call, booking, and dollar Layla brings in</li>
      </ul>
      ${p(`Log in, follow the checklist, and you can hear Layla answer your own phone before ${endsPretty}.`)}
      <p style="margin:24px 0 0 0;">${btn('Start here', `${APP_URL}/dashboard`)}</p>
      ${p(`<span style="font-size:13px;color:#6b7280;margin-top:16px;display:block;">Questions? Just reply to this email.</span>`)}
    `, "Tarhunna &middot; You're receiving this because your account's free trial was restarted.")

    try {
      await sendEmail({
        to: t.email!,
        subject: `Your Tarhunna trial is back — 14 days, everything unlocked (including Layla)`,
        html,
        idempotencyKey: `trial-started:${t.id}`,
      })
      sent++
      console.log(`  ✓ sent to ${t.email}`)
    } catch (err) {
      console.error(`  ✗ FAILED for ${t.email}:`, err instanceof Error ? err.message : err)
    }
  }
  console.log(`\nDone: ${sent}/${targets.length} sent.`)
}

main().catch(err => {
  console.error('Failed:', err)
  process.exit(1)
})
