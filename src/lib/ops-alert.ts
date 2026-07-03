/**
 * Operator alerting — "nothing fails silently."
 *
 * Before this existed, cron failures were console.error'd into
 * Vercel's ephemeral logs and the main cron returned ok:true even
 * when jobs threw — the operator found out about breakage when a
 * customer did. alertOperator() pushes failures to the operator's
 * inbox instead.
 *
 * Throttling: serverless instances share no memory, so the rate
 * limit rides on Resend's 24h idempotency dedup — the key embeds an
 * hour bucket, so each distinct alert key sends AT MOST once per
 * hour no matter how many lambdas fire it (an every-minute cron
 * failing all day = 24 emails, not 1,440).
 *
 * Recipient: OPS_ALERT_EMAIL, falling back to ADMIN_NOTIFY_EMAIL
 * (already set in prod for demo-request notifications). Missing both
 * logs loudly and drops — alerting must never take down the caller.
 * alertOperator NEVER throws.
 */

import { sendEmail, escapeHtml } from '@/lib/resend'
import { wrap, p } from '@/lib/email/branded'

/** Exported for tests: hour-bucketed Resend idempotency key. */
export function opsAlertIdempotencyKey(key: string, now: Date = new Date()): string {
  const hourBucket = Math.floor(now.getTime() / 3_600_000)
  return `ops:${key}:${hourBucket}`
}

export async function alertOperator(args: {
  /**
   * Stable identity for throttling, e.g. 'cron-main' or 'apperr:...'.
   * MUST be drawn from a bounded set — never embed request-derived or
   * error-message text (an attacker who can vary the key mints
   * unlimited hourly budgets and storms the inbox + Resend quota).
   */
  key: string
  subject: string
  /** Plain text; rendered as escaped paragraphs (split on newlines). */
  body: string
}): Promise<void> {
  try {
    const to = process.env.OPS_ALERT_EMAIL ?? process.env.ADMIN_NOTIFY_EMAIL
    if (!to) {
      console.error(`[ops-alert] NO RECIPIENT CONFIGURED (OPS_ALERT_EMAIL / ADMIN_NOTIFY_EMAIL) — dropping alert "${args.subject}"`)
      return
    }

    const paragraphs = args.body
      .split('\n')
      .filter(Boolean)
      .map((line) => p(escapeHtml(line)))
      .join('')

    const send = () => sendEmail({
      to,
      subject: `[Tarhunna ops] ${args.subject}`,
      html: wrap(paragraphs, 'Tarhunna &middot; automated operations alert (max one per issue per hour)'),
      idempotencyKey: opsAlertIdempotencyKey(args.key),
    })

    // 10s cap: alerts ride inside every-minute cron lambdas — a
    // hanging Resend connection (most likely exactly when things are
    // broken) must not stall job processing. The abandoned promise
    // just dies with the lambda.
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('ops-alert send timed out after 10s')), 10_000))

    try {
      await Promise.race([send(), timeout])
    } catch (firstErr) {
      const msg = firstErr instanceof Error ? firstErr.message : String(firstErr)
      // Same-key-different-body inside one hour → Resend 409
      // idempotency conflict. That means this hour's alert already
      // went out — working as intended, don't retry.
      if (/idempot/i.test(msg)) return
      // One retry for transient network/5xx — one-shot alerts
      // (provisioning exhaustion) have no later tick to self-heal.
      await Promise.race([send(), timeout])
    }
  } catch (err) {
    console.error('[ops-alert] failed to send alert:', err instanceof Error ? err.message : err)
  }
}
