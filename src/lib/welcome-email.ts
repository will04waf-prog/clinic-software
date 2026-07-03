/**
 * Day-0 welcome email — sent right after self-serve signup succeeds.
 *
 * Before this existed the first email an owner EVER received was the
 * 7-day trial reminder: an owner who signed up and closed the tab got
 * zero contact for a week. This is the cheapest re-engagement channel
 * we have, so it fires on every signup, and its three steps mirror the
 * dashboard SetupGuide's foundation group (services → hours → booking
 * page) so the email and the in-app checklist tell one story.
 *
 * Failure policy: NEVER fail the signup on email problems — callers
 * fire-and-forget with a .catch that logs. Idempotency key is
 * welcome:<orgId> so an accidental double-call inside Resend's 24h
 * dedup window collapses to one send.
 */

import { sendEmail, escapeHtml } from '@/lib/resend'
import { APP_URL, wrap, p, btn } from '@/lib/email/branded'

export async function sendWelcomeEmail(args: {
  orgId: string
  orgName: string
  ownerEmail: string
  ownerFullName: string
  trialEndsAt: string   // ISO
}): Promise<void> {
  // Signup requires no email verification, so clinic_name/full_name
  // are attacker-controllable for an arbitrary recipient address —
  // escape everything user-typed before it touches HTML.
  const rawFirstName = (args.ownerFullName ?? '').split(' ')[0] || 'there'
  const firstName = escapeHtml(rawFirstName)   // HTML body only
  const orgName = escapeHtml(args.orgName)
  const endsPretty = new Date(args.trialEndsAt).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric',
  })

  const html = wrap(`
    ${p(`Hi ${firstName},`)}
    ${p(`Welcome to Tarhunna! Your 14-day free trial for <strong>${orgName}</strong> is live — you have everything unlocked through <strong>${endsPretty}</strong>, including Layla, the AI receptionist who answers your clinic's phone and books appointments on the call.`)}
    ${p(`The fastest way to see the value: get your booking engine live. Three steps, about ten minutes:`)}
    <ol style="margin:0 0 16px 0;padding-left:20px;color:#374151;font-size:15px;line-height:1.9;">
      <li><strong>Add your services</strong> — the treatments clients can book, with prices</li>
      <li><strong>Set your hours</strong> — so only real availability gets booked</li>
      <li><strong>Publish your booking page</strong> — clients book themselves, 24/7</li>
    </ol>
    ${p(`Your dashboard walks you through each step, then through putting Layla on the phone.`)}
    <p style="margin:24px 0 0 0;">${btn('Open your dashboard', `${APP_URL}/dashboard`)}</p>
    ${p(`<span style="font-size:13px;color:#6b7280;margin-top:16px;display:block;">Questions? Just reply to this email.</span>`)}
  `)

  await sendEmail({
    to: args.ownerEmail,
    subject: `Welcome to Tarhunna — your free trial is live, ${rawFirstName}`,
    html,
    idempotencyKey: `welcome:${args.orgId}`,
  })
}
