/**
 * Per-key in-memory rate limiting for PUBLIC endpoints (capture form,
 * waitlist). The number-search route pioneered this Bucket shape; this
 * is the shared version it promised.
 *
 * Org-scoped keys, not IP-scoped: Vercel invocations see transient
 * IPs, so an attacker isn't reliably identifiable — but the resource
 * being protected (an org's lead pipeline + its owner's inbox) is
 * per-org, so capping per org bounds the damage regardless of source.
 *
 * Per-instance memory: a determined attacker spread across many warm
 * lambdas can exceed the nominal cap by a small factor — acceptable
 * for notification-flood protection; swap for KV if it ever matters.
 */

interface Bucket {
  count:   number
  resetAt: number
}

export function makeRateLimiter(limit: number, windowMs: number) {
  const buckets = new Map<string, Bucket>()
  return function consume(key: string, now: number = Date.now()): { ok: boolean; retryAfterSeconds: number } {
    // Expired buckets are normally overwritten in place, but IP-keyed
    // users see unique keys forever — sweep so a warm instance's map
    // can't grow without bound under key churn.
    if (buckets.size > 1000) {
      for (const [k, b] of buckets) {
        if (b.resetAt <= now) buckets.delete(k)
      }
    }
    const existing = buckets.get(key)
    if (!existing || existing.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs })
      return { ok: true, retryAfterSeconds: 0 }
    }
    if (existing.count >= limit) {
      return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)) }
    }
    existing.count += 1
    return { ok: true, retryAfterSeconds: 0 }
  }
}
