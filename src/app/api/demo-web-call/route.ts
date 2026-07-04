/**
 * Demo web-call grant — the server half of the in-browser "Talk to
 * Layla" affordance (src/components/marketing/talk-to-layla.tsx).
 *
 * GET  → { enabled } feature-flag check. Free: it consumes no rate
 *        limit, so the component can decide whether to render at all
 *        without spending a caller's slot.
 * POST → mints a "call grant": the Vapi public key, the demo assistant
 *        id, and the assistantOverrides both sides agree to. A Vapi
 *        public key is designed to be shipped to browsers, but every
 *        web call it starts costs real per-minute money — so the grant
 *        is what we throttle, not the key itself.
 *
 * Cost protection, in order:
 *   1. Per-IP limiter (3 / 10 min) — one curious visitor gets three
 *      tries, a scripted loop from one address gets cut off fast.
 *   2. Global limiter (20 / hour) — a distributed flood can burn at
 *      most ~1 hour of talk time per hour, org-wide. Checked AFTER the
 *      per-IP limiter so one abusive address can't drain the shared
 *      pool for everyone else.
 *   3. The overrides cap each granted call at 180s of talk and 30s of
 *      dead air. maxDurationSeconds is a top-level AssistantOverrides
 *      field in @vapi-ai/web 2.5.2; silenceTimeoutSeconds is accepted
 *      by the Vapi API on the same object (the 2.5.2 generated client
 *      type simply lags the REST schema).
 *
 * Same per-instance-memory caveat as every makeRateLimiter user: warm
 * lambdas each hold their own buckets, so the true ceiling is (limit ×
 * warm instances) — fine for demo-abuse protection, swap for KV if the
 * bill ever says otherwise.
 */

import { NextResponse } from 'next/server'
import { makeRateLimiter } from '@/lib/public-rate-limit'

export const runtime = 'nodejs'

const consumeIpSlot = makeRateLimiter(3, 10 * 60_000)
const consumeGlobalSlot = makeRateLimiter(20, 60 * 60_000)

/** The public demo assistant — the same Layla that answers (301) 962-2856. */
const DEMO_ASSISTANT_ID = '42645506-c121-4b69-8f7d-a164bdd32a42'

/** Hard caps sent as assistantOverrides on every granted web call. */
const CALL_CAPS = {
  maxDurationSeconds: 180,
  silenceTimeoutSeconds: 30,
} as const

function rateLimited(retryAfterSeconds: number) {
  return NextResponse.json(
    { error: 'rate_limited', retryAfterSeconds },
    { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
  )
}

export async function GET() {
  return NextResponse.json({ enabled: !!process.env.VAPI_PUBLIC_KEY })
}

export async function POST(request: Request) {
  const publicKey = process.env.VAPI_PUBLIC_KEY
  if (!publicKey) {
    return NextResponse.json({ enabled: false }, { status: 503 })
  }

  // First hop of x-forwarded-for is the client as Vercel saw it.
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'

  // Sequential on purpose: an IP that's already over its own cap must
  // not consume a slot from the shared global pool.
  const perIp = consumeIpSlot(ip)
  if (!perIp.ok) {
    return rateLimited(perIp.retryAfterSeconds)
  }
  const global = consumeGlobalSlot('global')
  if (!global.ok) {
    return rateLimited(global.retryAfterSeconds)
  }

  return NextResponse.json({
    publicKey,
    assistantId: DEMO_ASSISTANT_ID,
    overrides: CALL_CAPS,
  })
}
