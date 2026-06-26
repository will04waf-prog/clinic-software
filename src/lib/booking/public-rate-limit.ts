/**
 * Anonymous booking-endpoint rate limit — Phase 4 W2.
 *
 * In-memory IP-bucket limiter for the public POST endpoints
 * (/api/booking/hold and /api/booking/confirm). Anonymous endpoints
 * are abuse magnets, so we cap aggressive request rates at the edge
 * before we touch the DB or do hold-row inserts.
 *
 * This is a single-process in-memory store. It works fine for one
 * Vercel serverless instance, but each cold-start instance has its
 * own map. When we deploy on real infrastructure (or see a real
 * abuse event), swap for an Upstash Redis or Vercel KV store — the
 * `consume()` contract stays the same.
 */

interface Bucket {
  count: number
  resetAt: number
}

// Process-wide bucket store. Keyed by `${ip}:${scope}`.
const BUCKETS: Map<string, Bucket> = new Map()

export interface RateLimitConfig {
  /** Logical bucket name (e.g. 'hold', 'confirm'). */
  scope: string
  /** Max requests in the window. */
  limit: number
  /** Window length in ms. */
  windowMs: number
}

export interface RateLimitResult {
  ok: boolean
  remaining: number
  retryAfterSeconds: number
}

/**
 * Consume one slot from the (ip, scope) bucket. Returns
 * { ok: false, retryAfterSeconds } when the bucket is exhausted.
 * Use the ip provided by the route handler — DO NOT trust raw
 * X-Forwarded-For without your platform's vetting (Vercel injects
 * a trustworthy x-forwarded-for; the caller passes that).
 */
export function consume(ip: string, cfg: RateLimitConfig, now: number = Date.now()): RateLimitResult {
  const key = `${ip}:${cfg.scope}`
  const existing = BUCKETS.get(key)

  if (!existing || existing.resetAt <= now) {
    BUCKETS.set(key, { count: 1, resetAt: now + cfg.windowMs })
    return { ok: true, remaining: cfg.limit - 1, retryAfterSeconds: 0 }
  }

  if (existing.count >= cfg.limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000))
    return { ok: false, remaining: 0, retryAfterSeconds }
  }

  existing.count += 1
  return { ok: true, remaining: cfg.limit - existing.count, retryAfterSeconds: 0 }
}

/**
 * Best-effort IP extraction from a Next.js Request. Prefers the
 * x-forwarded-for header set by Vercel/most reverse proxies. Falls
 * back to a stable sentinel so anonymous abuse from a stripped-header
 * client still gets rate-limited under a single bucket.
 */
export function ipFor(req: Request): string {
  const xff = req.headers.get('x-forwarded-for') ?? ''
  const first = xff.split(',')[0].trim()
  if (first.length > 0 && first.length < 64) return first
  const real = req.headers.get('x-real-ip') ?? ''
  if (real.length > 0 && real.length < 64) return real.trim()
  return 'unknown'
}

// Tunable presets — tightened narrowly enough to deter abuse, loose
// enough to never bite a legitimate patient walking through the flow.
export const HOLD_LIMIT: RateLimitConfig = {
  scope: 'hold',
  limit: 10,
  windowMs: 60 * 60 * 1000, // 10 holds per hour per IP
}

export const CONFIRM_LIMIT: RateLimitConfig = {
  scope: 'confirm',
  limit: 20,
  windowMs: 60 * 60 * 1000, // 20 confirms per hour per IP
}

// Phase 4 W5: /manage/[token] reschedule + cancel routes. Tighter
// than hold/confirm because a real patient only needs a handful of
// reschedules — abuse is the most plausible explanation for bursts.
export const RESCHEDULE_LIMIT: RateLimitConfig = {
  scope: 'reschedule',
  limit: 10,
  windowMs: 60 * 60 * 1000, // 10 reschedules per hour per IP
}

export const CANCEL_LIMIT: RateLimitConfig = {
  scope: 'cancel',
  limit: 5,
  windowMs: 60 * 60 * 1000, // 5 cancels per hour per IP
}
