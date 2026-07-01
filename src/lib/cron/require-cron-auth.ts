import { NextResponse } from 'next/server'

/**
 * Shared authorization gate for every cron route.
 *
 * Why this exists (audit M1): each cron route previously inlined
 *   const secret = process.env.CRON_SECRET
 *   if (secret) { ...require Bearer... }
 * which FAILS OPEN when CRON_SECRET is unset — the endpoint becomes
 * world-callable. That is dangerous for e.g. /api/cron/voice-reminders,
 * which places billable outbound Vapi calls that dial patients. This
 * helper makes the gate fail CLOSED in production, mirroring the posture
 * of verify-vapi-signature.ts (which returns false in prod when it can't
 * verify).
 *
 * Behavior:
 *   - CRON_SECRET set   → require `Authorization: Bearer <secret>` (401 otherwise).
 *     Vercel Cron injects this header automatically when the env var is set,
 *     so legitimate scheduled invocations pass.
 *   - CRON_SECRET unset, production → 500 (refuse to run; misconfiguration).
 *     IMPORTANT: CRON_SECRET must be set in the Vercel project env or the
 *     crons will stop running after this ships.
 *   - CRON_SECRET unset, non-production → allow (local dev / manual triggers).
 *
 * Usage at the top of each cron POST handler:
 *   const denied = requireCronAuth(request)
 *   if (denied) return denied
 */
export function requireCronAuth(request: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET

  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[cron-auth] CRON_SECRET is not set — refusing to run cron in production')
      return NextResponse.json(
        { error: 'Server misconfigured: CRON_SECRET is not set' },
        { status: 500 },
      )
    }
    // Dev/test convenience: allow manual triggers when no secret is configured.
    return null
  }

  const auth = request.headers.get('authorization')
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return null
}
