/**
 * Iterative Levenshtein distance. O(n × m) time, O(min(n, m)) space.
 *
 * Used to measure how much the human edited an AI draft before
 * sending. Capped at a max so a 10kb pathological string can't
 * stall the request — if either input is longer than the cap we
 * compare just the prefixes.
 *
 * Pure utility, no React/Next imports — runs fine in API routes
 * and migration scripts alike.
 */

const MAX_INPUT_LEN = 2000

export function levenshtein(a: string, b: string): number {
  const aa = a.length > MAX_INPUT_LEN ? a.slice(0, MAX_INPUT_LEN) : a
  const bb = b.length > MAX_INPUT_LEN ? b.slice(0, MAX_INPUT_LEN) : b
  if (aa === bb) return 0
  if (aa.length === 0) return bb.length
  if (bb.length === 0) return aa.length

  // Single rolling row.
  const m = aa.length
  const n = bb.length
  let prev = new Array<number>(n + 1)
  let curr = new Array<number>(n + 1)
  for (let j = 0; j <= n; j++) prev[j] = j

  for (let i = 1; i <= m; i++) {
    curr[0] = i
    const aCh = aa.charCodeAt(i - 1)
    for (let j = 1; j <= n; j++) {
      const cost = aCh === bb.charCodeAt(j - 1) ? 0 : 1
      curr[j] = Math.min(
        prev[j] + 1,        // delete
        curr[j - 1] + 1,    // insert
        prev[j - 1] + cost, // substitute
      )
    }
    const tmp = prev
    prev = curr
    curr = tmp
  }
  return prev[n]
}
