/**
 * Phase 4 W6 — DST-safe day bucketing for the owner calendar view.
 *
 * The booking flow lives in clinic time. The owner's calendar must
 * mirror that — a 9pm consultation on Tuesday in Eastern time must
 * appear under "Tuesday" no matter what timezone the OWNER's BROWSER
 * is in. The naive `new Date(scheduled_at).toDateString()` approach
 * uses the browser's local timezone and silently mis-buckets every
 * appointment within ~5 hours of midnight when the owner is in a
 * different timezone than the clinic.
 *
 * The fix: bucket with Intl.DateTimeFormat({ timeZone }) using the
 * `en-CA` locale (which produces YYYY-MM-DD shape) — the same
 * pattern the ReschedulePicker on /manage/[token] already uses, and
 * the same pattern the public booking page uses for slot grouping.
 *
 * This module is pure: no React, no DB, no side effects. Easily
 * inspectable from a scratch script for DST edge cases (spring
 * forward, fall back, southern-hemisphere clinics, half-hour-offset
 * zones like Newfoundland or India).
 */

export type DayKey = string // YYYY-MM-DD in clinic timezone

/**
 * Compute the YYYY-MM-DD key for an instant in the given timezone.
 * Uses en-CA which natively formats to YYYY-MM-DD without locale
 * surprises (en-US would yield "MM/DD/YYYY"). Works correctly across
 * DST transitions because Intl.DateTimeFormat resolves IANA zones.
 */
export function dayKeyInTz(iso: string | Date, timezone: string): DayKey {
  const d = typeof iso === 'string' ? new Date(iso) : iso
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year:  'numeric',
    month: '2-digit',
    day:   '2-digit',
  }).format(d)
}

/**
 * Bucket a list of items into clinic-local days. Items are sorted by
 * the supplied `getStartIso` value within each day. Output ordering
 * is by ascending day key.
 *
 * Returns a flat array (not a Map) so React can render it with
 * stable key={bucket.day}. The day key is YYYY-MM-DD which is also
 * sortable as a string — no Date math needed downstream.
 */
export function bucketByClinicDay<T>(
  items: T[],
  timezone: string,
  getStartIso: (item: T) => string,
): Array<{ day: DayKey; items: T[] }> {
  const map = new Map<DayKey, T[]>()
  for (const item of items) {
    const key = dayKeyInTz(getStartIso(item), timezone)
    const bucket = map.get(key)
    if (bucket) {
      bucket.push(item)
    } else {
      map.set(key, [item])
    }
  }
  // Sort within each day by start time.
  for (const arr of map.values()) {
    arr.sort((a, b) => getStartIso(a).localeCompare(getStartIso(b)))
  }
  // Sort days ascending. YYYY-MM-DD is lexicographically sortable.
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, items]) => ({ day, items }))
}

/**
 * Compute the 7-day range (Mon..Sun in clinic time) that contains
 * the supplied reference date. Returns the YYYY-MM-DD keys, ordered
 * Mon → Sun, so the calendar header columns are stable regardless of
 * the user's browser locale (en-US would render Sun first; we always
 * render Mon first).
 *
 * The reference date can be any instant; the bucketing happens in
 * clinic time, so a Sunday 11pm reference in clinic time stays on
 * THAT week (not next week's Monday).
 */
export function weekDayKeysContaining(ref: string | Date, timezone: string): DayKey[] {
  const refDate = typeof ref === 'string' ? new Date(ref) : ref
  // Find the clinic-local weekday for `ref`. Intl 'en-US' weekday
  // short → "Mon", "Tue", etc.
  const weekdayFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
  })
  const WEEKDAY_INDEX: Record<string, number> = {
    Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6,
  }
  const idxOfRef = WEEKDAY_INDEX[weekdayFmt.format(refDate)] ?? 0
  // ── DST safety: iterate via shiftDayKey rather than ±86.4M-ms.
  // Adding 86.4M ms across a DST boundary at the wrong moment can
  // skip a day (spring forward) or duplicate a day (fall back) when
  // the ref's wall-clock sits inside the offset window. shiftDayKey
  // anchors at noon UTC of each successive day, which is robust for
  // every IANA zone (-12..+14, half-hour zones included).
  const startKey = shiftDayKey(dayKeyInTz(refDate, timezone), -idxOfRef, timezone)
  const days: DayKey[] = []
  for (let i = 0; i < 7; i++) {
    days.push(shiftDayKey(startKey, i, timezone))
  }
  return days
}

/**
 * Add (or subtract) N clinic-local days to a day key (YYYY-MM-DD).
 * Built on UTC-noon math so a DST transition inside the offset
 * doesn't slip the result by an hour into the prior/next day.
 *
 * Use this for prev/next-week navigation: shiftDayKey(dayKey, 7).
 */
export function shiftDayKey(key: DayKey, deltaDays: number, timezone: string): DayKey {
  // Find a UTC instant whose clinic-local date matches `key`. Noon
  // UTC works for most zones (-12..+12) but Pacific/Kiritimati
  // (UTC+14) and similar can be a full day ahead, so we may need to
  // step back. Conversely, very-negative zones could need to step
  // forward. Two iterations is sufficient for every IANA zone.
  const [y, m, d] = key.split('-').map(Number)
  let probeMs = Date.UTC(y, m - 1, d, 12, 0, 0)
  for (let i = 0; i < 3; i++) {
    const actual = dayKeyInTz(new Date(probeMs), timezone)
    if (actual === key) break
    probeMs += (actual < key ? 1 : -1) * 86_400_000
  }
  return dayKeyInTz(new Date(probeMs + deltaDays * 86_400_000), timezone)
}

/**
 * Minutes since clinic-local midnight for an instant. Used to anchor
 * tiles vertically on the calendar grid via a minute → percent math
 * that's DST-safe (Intl handles the offset for the day in question).
 */
export function minutesSinceMidnightInTz(iso: string | Date, timezone: string): number {
  const d = typeof iso === 'string' ? new Date(iso) : iso
  // hourCycle: 'h23' pins the output to 00-23 across all platforms.
  // Without it, some Node + Safari builds return "24" for midnight,
  // which would silently bump tiles to the next day in the grid.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour:     '2-digit',
    minute:   '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d)
  const hourPart   = parts.find(p => p.type === 'hour')?.value ?? '0'
  const minutePart = parts.find(p => p.type === 'minute')?.value ?? '0'
  return Number(hourPart) * 60 + Number(minutePart)
}
