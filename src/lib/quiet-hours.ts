/**
 * Quiet-hours math for the AI Twin auto-draft hook.
 *
 * The auto-draft side-effect needs to decide: given "now" in UTC, the
 * org's IANA timezone, and a local-time [start, end) window (possibly
 * wrapping past midnight), is "now" inside the window, and if so when
 * does the window close in UTC?
 *
 * Why a dedicated helper: this is the only piece of W4 that requires
 * real reasoning — IANA timezones, DST transitions, midnight wrap.
 * Keeping it pure and side-effect-free means autoDraftForInbound()
 * stays a straight line and we can reason about (eventually unit-
 * test) the timezone math in isolation.
 *
 * Strategy: never assume a fixed UTC offset. Use
 * Intl.DateTimeFormat({ timeZone, ... }).formatToParts() to read the
 * wall-clock components in the target zone, then iterate forward in
 * coarse hour steps from "now" to find the first instant whose
 * local-time hour/minute equals the configured end-of-window. This
 * sidesteps DST jumps without us doing offset arithmetic.
 */

type HHMM = `${number}${number}:${number}${number}` | string

interface LocalParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

/**
 * Format a UTC instant into wall-clock parts in the target IANA zone.
 * Returns null for an invalid zone (treated as "no quiet hours").
 */
function partsInZone(date: Date, timeZone: string): LocalParts | null {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year:   'numeric',
      month:  '2-digit',
      day:    '2-digit',
      hour:   '2-digit',
      minute: '2-digit',
      hour12: false,
    })
    const parts = fmt.formatToParts(date)
    const get = (t: string) => Number(parts.find(p => p.type === t)?.value ?? NaN)
    const year   = get('year')
    const month  = get('month')
    const day    = get('day')
    let   hour   = get('hour')
    const minute = get('minute')
    // Intl returns "24" for midnight in some node/icu combos; normalize.
    if (hour === 24) hour = 0
    if ([year, month, day, hour, minute].some(n => !Number.isFinite(n))) return null
    return { year, month, day, hour, minute }
  } catch {
    return null
  }
}

/**
 * Parse "HH:MM" (or "HH:MM:SS") into {hour, minute}. Returns null on
 * malformed input.
 */
function parseHHMM(s: string | null | undefined): { hour: number; minute: number } | null {
  if (!s) return null
  const m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/)
  if (!m) return null
  const hour = Number(m[1])
  const minute = Number(m[2])
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  return { hour, minute }
}

/**
 * Is the wall-clock time t inside [start, end) where times are
 * minutes-of-day? Handles the wrap case (start > end) by treating
 * the window as [start, 24:00) ∪ [00:00, end).
 */
function inWindow(tMin: number, startMin: number, endMin: number): boolean {
  if (startMin === endMin) return false
  if (startMin < endMin) {
    return tMin >= startMin && tMin < endMin
  }
  // wrap-around (e.g. 21:00 -> 08:00)
  return tMin >= startMin || tMin < endMin
}

/**
 * Compute the next "end-of-window" UTC ISO string, or null if "now"
 * is not in the quiet-hours window.
 *
 * @param now       The reference instant (typically new Date()).
 * @param timeZone  IANA zone of the org (e.g. 'America/New_York').
 * @param startHHMM Local-time window start (e.g. '21:00'). Null = no window.
 * @param endHHMM   Local-time window end (e.g. '08:00'). Null = no window.
 *
 * Returns: an ISO string when now is inside the window, otherwise null.
 */
export function computeAvailableAfter(
  now: Date,
  timeZone: string | null | undefined,
  startHHMM: string | null | undefined,
  endHHMM: string | null | undefined,
): string | null {
  if (!timeZone) return null
  const start = parseHHMM(startHHMM)
  const end   = parseHHMM(endHHMM)
  if (!start || !end) return null
  if (start.hour === end.hour && start.minute === end.minute) return null

  const nowLocal = partsInZone(now, timeZone)
  if (!nowLocal) return null

  const nowMin   = nowLocal.hour * 60 + nowLocal.minute
  const startMin = start.hour * 60 + start.minute
  const endMin   = end.hour   * 60 + end.minute

  if (!inWindow(nowMin, startMin, endMin)) return null

  // We're inside the window. Find the next UTC instant whose local
  // wall-clock equals end.hour:end.minute. Iterate forward in 1-hour
  // probes from now; once we cross into the target hour, narrow to
  // the exact minute. ICU + Intl handles DST shifts implicitly.
  //
  // The window is at most ~24h long, so we cap iteration at 48h to
  // be safe.
  const STEP_MS = 60_000 // 1-minute granularity is fine; quiet hours are HH:MM.
  const MAX_STEPS = 48 * 60

  let probe = new Date(now.getTime())
  for (let i = 0; i < MAX_STEPS; i++) {
    probe = new Date(probe.getTime() + STEP_MS)
    const p = partsInZone(probe, timeZone)
    if (!p) return null
    if (p.hour === end.hour && p.minute === end.minute) {
      // Snap to second-zero of that minute for cleanliness.
      const snapped = new Date(probe.getTime() - (probe.getSeconds() * 1000 + probe.getMilliseconds()))
      return snapped.toISOString()
    }
  }

  // Shouldn't be reachable for sane inputs; bail with null rather
  // than throw so the caller treats it as "not in quiet hours."
  return null
}
