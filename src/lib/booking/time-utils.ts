/**
 * Phase 4 W1 — timezone helpers for the availability engine.
 *
 * Same playbook as src/lib/quiet-hours.ts: never assume a
 * fixed UTC offset. Use Intl.DateTimeFormat({ timeZone }).
 * formatToParts() to read clinic-local wall-clock components
 * from a UTC instant, then converge on the right UTC value
 * by iterating in minute steps. ICU handles DST shifts.
 *
 * Everything here is pure: no DB, no fetch, no Supabase. The
 * engine in availability.ts composes these helpers; tests can
 * import them directly.
 */

export interface LocalParts {
  year:   number
  month:  number   // 1..12
  day:    number   // 1..31
  hour:   number   // 0..23
  minute: number   // 0..59
}

/**
 * Format a UTC instant into wall-clock parts in the target
 * IANA zone. Returns null for an invalid zone.
 */
export function partsInZone(date: Date, timeZone: string): LocalParts | null {
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
    // ICU returns "24" for midnight in some node builds.
    if (hour === 24) hour = 0
    if ([year, month, day, hour, minute].some(n => !Number.isFinite(n))) return null
    return { year, month, day, hour, minute }
  } catch {
    return null
  }
}

/**
 * Parse "HH:MM" into minutes-of-day. Returns null on malformed
 * input. Strict to match the DB CHECK constraint
 * (`^([01][0-9]|2[0-3]):[0-5][0-9]$`) so engine and storage agree:
 * "9:00" is rejected, "09:00" is the canonical form.
 */
export function parseHHMM(s: string | null | undefined): number | null {
  if (!s) return null
  const m = s.match(/^([01]\d|2[0-3]):([0-5]\d)$/)
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

/** YYYY-MM-DD slug for a clinic-local date — used as the key
 *  for override matching, and as a stable cache key in the
 *  engine.
 */
export function dateKey(parts: { year: number; month: number; day: number }): string {
  const yyyy = String(parts.year).padStart(4, '0')
  const mm   = String(parts.month).padStart(2, '0')
  const dd   = String(parts.day).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

/** 0=Sunday … 6=Saturday for a clinic-local date. */
export function weekdayForLocalDate(parts: { year: number; month: number; day: number }): number {
  // Date.UTC is offset-free; .getUTCDay() gives the weekday of
  // the calendar date itself, independent of any zone math.
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay()
}

/**
 * Convert a clinic-local wall-clock (date + minutes-of-day) to
 * a concrete UTC Date.
 *
 * Strategy: seed with Date.UTC(...) at the target HH:MM (which
 * assumes UTC), then read what that instant ACTUALLY looks like
 * in the target zone, and shift by the delta. Iterate once more
 * because DST boundary days have a ±60-minute jump.
 *
 * Returns null for an invalid zone, or null if the wall-clock
 * does not exist (the spring-forward gap, e.g. 02:30 on a US
 * DST Sunday).
 *
 * DST fall-back asymmetry: on a fall-back day, the wall-clock
 * interval 01:00-02:00 occurs twice in real time (once before the
 * jump, once after). This function deterministically converges to
 * the FIRST occurrence — the pre-fall-back UTC instant — and the
 * second occurrence is never emitted. That's the correct behavior
 * for a booking engine: no duplicate slots, deterministic mapping,
 * and clinics are closed at 1:30am anyway. If a clinic ever needs
 * to book during the ambiguous hour, this is the comment to revisit.
 */
export function localToUtc(
  parts: { year: number; month: number; day: number },
  minutesOfDay: number,
  timeZone: string,
): Date | null {
  const hh = Math.floor(minutesOfDay / 60)
  const mm = minutesOfDay % 60
  let probe = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, hh, mm, 0, 0))

  for (let i = 0; i < 4; i++) {
    const local = partsInZone(probe, timeZone)
    if (!local) return null
    const targetMin =
      parts.year   * 525_600 +
      parts.month  *  44_640 +
      parts.day    *   1_440 +
      minutesOfDay
    const probeMin =
      local.year   * 525_600 +
      local.month  *  44_640 +
      local.day    *   1_440 +
      local.hour   *      60 +
      local.minute
    const deltaMin = targetMin - probeMin
    if (deltaMin === 0) return probe
    probe = new Date(probe.getTime() + deltaMin * 60_000)
  }

  // After 4 iterations we should have converged. If we did not,
  // the wall-clock probably doesn't exist (DST spring-forward
  // gap). Return null so the engine drops the slot rather than
  // emit a wrong UTC.
  const final = partsInZone(probe, timeZone)
  if (!final) return null
  if (final.year !== parts.year || final.month !== parts.month || final.day !== parts.day) return null
  if (final.hour * 60 + final.minute !== minutesOfDay) return null
  return probe
}

/**
 * Iterate clinic-local calendar dates between two UTC instants
 * (inclusive of both ends' local dates). Used by the engine to
 * know which weekdays / override rows are in scope.
 *
 * Caps at 400 days as a safety rail — the engine should never
 * scan more than ~365 days (booking_horizon_days max).
 */
export function enumerateLocalDates(
  fromUtc: Date,
  toUtc: Date,
  timeZone: string,
): LocalParts[] {
  const start = partsInZone(fromUtc, timeZone)
  const end   = partsInZone(toUtc,   timeZone)
  if (!start || !end) return []

  const out: LocalParts[] = []
  let cur = new Date(Date.UTC(start.year, start.month - 1, start.day, 12, 0, 0, 0))
  const endKey = dateKey(end)

  for (let i = 0; i < 400; i++) {
    const local = partsInZone(cur, timeZone)
    if (!local) break
    // Snap reported parts to noon so DST jitter doesn't shift
    // the calendar date we record.
    out.push({ year: local.year, month: local.month, day: local.day, hour: 12, minute: 0 })
    if (dateKey(local) === endKey) break
    cur = new Date(cur.getTime() + 24 * 60 * 60 * 1000)
  }
  return out
}

export interface MinuteInterval {
  startMin: number
  endMin:   number
}

/**
 * Union a list of half-open minute intervals. The engine uses
 * this to combine multiple per-(provider,weekday) rules (e.g.
 * 9-12 and 13-17) and multiple custom overrides on the same
 * date into a single open list.
 */
export function unionIntervals(intervals: MinuteInterval[]): MinuteInterval[] {
  if (intervals.length === 0) return []
  const sorted = [...intervals].sort((a, b) => a.startMin - b.startMin)
  const out: MinuteInterval[] = []
  let cur = { ...sorted[0] }
  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i]
    if (next.startMin <= cur.endMin) {
      cur.endMin = Math.max(cur.endMin, next.endMin)
    } else {
      out.push(cur)
      cur = { ...next }
    }
  }
  out.push(cur)
  return out
}

/** Half-open overlap test for UTC instants: [aStart, aEnd) ∩ [bStart, bEnd) ≠ ∅. */
export function overlapsUtc(
  aStart: Date, aEnd: Date,
  bStart: Date, bEnd: Date,
): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime()
}
