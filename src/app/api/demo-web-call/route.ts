/**
 * Demo web-call grant — the server half of the in-browser "Talk to
 * Layla" affordance (src/components/marketing/talk-to-layla.tsx).
 *
 * GET  → { enabled } feature-flag check (kept for ops smoke tests; the
 *        page itself gates on the env var server-side).
 * POST → mints a "call grant": the Vapi public key, the WEB demo
 *        assistant id, and advisory assistantOverrides.
 *
 * Cost protection, in order of what actually holds:
 *   1. THE ASSISTANT RECORD. Web calls use a dedicated assistant
 *      (Tarhunna Aesthetics web demo) whose maxDurationSeconds=180 and
 *      silenceTimeoutSeconds=30 are pinned on the Vapi record itself —
 *      a client that strips the overrides still gets cut at 180s. The
 *      phone demo line keeps its own uncapped assistant.
 *   2. Origin allowlist on POST — third-party pages can't mint grants
 *      from a visitor's browser.
 *   3. Per-IP limiter (3 / 10 min) + global limiter (20 / hour,
 *      checked second so an abusive IP can't drain the shared pool).
 *      Honest-client throttles: a leaked public key can start calls
 *      without this endpoint, which is exactly why cap #1 lives on the
 *      assistant record and why the key should be origin-locked in the
 *      Vapi dashboard. Total-call-count exposure is bounded by Vapi's
 *      org-level concurrency limit, not by us.
 *   4. The overrides ride along as belt-and-suspenders for our own
 *      client. (maxDurationSeconds is a top-level AssistantOverrides
 *      field in @vapi-ai/web 2.5.2; silenceTimeoutSeconds is accepted
 *      by the REST API — the generated type simply lags.)
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

/**
 * The WEB demo assistant — same brain, voice, and tools as the Layla
 * that answers (301) 962-2856, but a separate Vapi record with
 * maxDurationSeconds=180 / silenceTimeoutSeconds=30 pinned server-side
 * so browser callers can't run up the meter.
 */
const WEB_DEMO_ASSISTANT_ID = '9410db69-f98f-4dbc-a85f-67dd5c2b821a'

/** Advisory copy of the caps already pinned on the assistant record. */
const CALL_CAPS = {
  maxDurationSeconds: 180,
  silenceTimeoutSeconds: 30,
} as const

/** Origins allowed to mint grants from a browser. */
const ALLOWED_ORIGIN = /^https?:\/\/(localhost(:\d+)?|(www\.)?tarhunna\.net)$/

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

  // Browsers always send Origin on cross-origin POSTs — reject embeds
  // from other sites. (A missing Origin means a non-browser client;
  // the rate limiters below are the backstop there.)
  const origin = request.headers.get('origin')
  if (origin && !ALLOWED_ORIGIN.test(origin)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
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
    assistantId: WEB_DEMO_ASSISTANT_ID,
    overrides: CALL_CAPS,
  })
}
