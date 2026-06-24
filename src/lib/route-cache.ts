/**
 * Tiny per-process in-memory TTL cache. Lives at module scope so a
 * single Node worker memoizes recent results — enough to absorb the
 * second-by-second polling cost on heavy aggregation endpoints
 * (/api/dashboard/morning, /api/dashboard/analytics).
 *
 * NOT a distributed cache. On Vercel each cold function invocation
 * starts with an empty map, which is fine — the goal is "don't run
 * the same 7-query aggregation eight times in a minute when one
 * user is sitting on the dashboard."
 *
 * Org-scoped: callers build their own key including the org id so
 * one org's cached payload is never returned for another.
 */

interface Entry<T> {
  value: T
  expiresAt: number
}

const store = new Map<string, Entry<unknown>>()

export function getCached<T>(key: string): T | null {
  const hit = store.get(key) as Entry<T> | undefined
  if (!hit) return null
  if (hit.expiresAt < Date.now()) {
    store.delete(key)
    return null
  }
  return hit.value
}

export function setCached<T>(key: string, value: T, ttlMs: number): void {
  store.set(key, { value, expiresAt: Date.now() + ttlMs })
}

/**
 * Convenience wrapper: returns the cached value if fresh, otherwise
 * runs `producer`, stores its result, and returns it.
 */
export async function cached<T>(
  key: string,
  ttlMs: number,
  producer: () => Promise<T>,
): Promise<T> {
  const hit = getCached<T>(key)
  if (hit !== null) return hit
  const value = await producer()
  setCached(key, value, ttlMs)
  return value
}
