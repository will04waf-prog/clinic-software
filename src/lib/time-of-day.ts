/**
 * Time-of-day helpers — used by the dashboard brief to pick a
 * greeting and brief label that matches the clinic owner's local
 * time, not the server's UTC clock.
 *
 * Buckets:
 *   - 5am..11:59am  → morning  ("Good morning" / "Morning brief")
 *   - 12pm..4:59pm  → afternoon ("Good afternoon" / "Afternoon brief")
 *   - 5pm..4:59am   → night    ("Good evening" / "Night brief")
 *
 * Evening and overnight are bucketed together because the dashboard
 * is the same surface — anyone opening it at 8pm vs 1am gets the
 * same "wind-down" framing. Splitting them would add a fourth label
 * without a meaningfully different brief.
 */

export type TimeOfDay = 'morning' | 'afternoon' | 'night'

/**
 * Returns the hour (0-23) in the given IANA timezone for the given
 * instant. Falls back to UTC hour if the timezone is null/empty or
 * Intl rejects it.
 */
export function localHour(now: Date, timezone: string | null | undefined): number {
  if (!timezone) return now.getUTCHours()
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      hour12: false,
      timeZone: timezone,
    })
    // Intl can return "24" for midnight in some locales — normalize.
    const parsed = parseInt(fmt.format(now), 10)
    if (Number.isNaN(parsed)) return now.getUTCHours()
    return parsed % 24
  } catch {
    return now.getUTCHours()
  }
}

export function timeOfDay(now: Date, timezone: string | null | undefined): TimeOfDay {
  const h = localHour(now, timezone)
  if (h >= 5  && h < 12) return 'morning'
  if (h >= 12 && h < 17) return 'afternoon'
  return 'night'
}

/** "Good morning" / "Good afternoon" / "Good evening". */
export function greetingFor(tod: TimeOfDay): string {
  switch (tod) {
    case 'morning':   return 'Good morning'
    case 'afternoon': return 'Good afternoon'
    case 'night':     return 'Good evening'
  }
}

/** "Morning brief" / "Afternoon brief" / "Night brief" — used as the hero badge. */
export function briefLabelFor(tod: TimeOfDay): string {
  switch (tod) {
    case 'morning':   return 'Morning brief'
    case 'afternoon': return 'Afternoon brief'
    case 'night':     return 'Night brief'
  }
}
