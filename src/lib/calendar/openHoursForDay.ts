/**
 * Phase 4 W7 — clinic-wide open-hours for a given day key.
 *
 * The owner calendar view shades the column background to show when
 * the clinic is open. This helper resolves "any provider open at all"
 * intervals per day, combining recurring availability_rules with the
 * per-day availability_overrides.
 *
 * Output shape: array of [startMin, endMin] half-open intervals,
 * clinic-local minutes from midnight. The calendar grid renders
 * each as a faint mint fill. No timezone math here — the day key
 * IS clinic-local; rules and overrides are stored in clinic-local
 * HH:MM strings.
 *
 * Precedence — MIRRORS src/lib/booking/availability.ts:140-152 step
 * for step, because the calendar shading must NEVER claim a slot is
 * open that the booking engine would refuse, and vice versa.
 * Per-provider resolution:
 *   1. If a per-provider `closed` override exists for the day,
 *      provider has no open intervals (provider-specific closures
 *      win over everything else for that provider).
 *   2. Else union ALL `custom` overrides touching that provider —
 *      both per-provider customs AND clinic-wide customs (provider_id
 *      NULL) apply. If any custom rows exist, they REPLACE the
 *      provider's recurring rules for the day.
 *   3. Else use the provider's recurring rules for that weekday.
 * Clinic-wide closure (provider_id NULL, kind='closed') short-circuits
 * the entire day to [] before any per-provider work — that's a
 * holiday/closure that applies to every provider.
 *
 * Then union across providers for the "is the clinic open?"
 * semantics the owner cares about.
 *
 * Pure function. No React, no DB.
 */

export interface AvailabilityRule {
  provider_id: string
  /** 0=Sunday .. 6=Saturday */
  weekday:    number
  /** HH:MM clinic-local */
  start_time: string
  /** HH:MM clinic-local */
  end_time:   string
}

export interface AvailabilityOverride {
  provider_id: string | null // null = clinic-wide
  kind:        'closed' | 'custom'
  date:        string        // YYYY-MM-DD clinic-local
  start_time:  string | null // HH:MM, present when kind='custom'
  end_time:    string | null
}

export interface MinuteInterval {
  startMin: number
  endMin:   number
}

function parseHHMM(s: string): number {
  const [h, m] = s.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

/** Union a list of [start, end) intervals into a sorted, merged list.
 *  Discards zero-width / inverted intervals silently — those come from
 *  malformed DB rows and shouldn't fight the rest of the union. */
function unionIntervals(intervals: MinuteInterval[]): MinuteInterval[] {
  const valid = intervals.filter(iv =>
    Number.isFinite(iv.startMin) &&
    Number.isFinite(iv.endMin) &&
    iv.endMin > iv.startMin
  )
  if (valid.length === 0) return []
  const sorted = [...valid].sort((a, b) => a.startMin - b.startMin)
  const out: MinuteInterval[] = [{ ...sorted[0] }]
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1]
    const next = sorted[i]
    if (next.startMin <= last.endMin) {
      last.endMin = Math.max(last.endMin, next.endMin)
    } else {
      out.push({ ...next })
    }
  }
  return out
}

function weekdayOf(dayKey: string): number {
  const [y, m, d] = dayKey.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

export function openHoursForDay(
  dayKey: string,
  providerIds: string[],
  rules: AvailabilityRule[],
  overrides: AvailabilityOverride[],
): MinuteInterval[] {
  // ── Step 1: filter today's overrides. ──
  const todays = overrides.filter(o => o.date === dayKey)

  // ── Step 2: short-circuit on clinic-wide closure for the day. ──
  // A holiday or whole-clinic closure trumps everything else.
  const clinicWideClosure = todays.find(o => o.provider_id === null && o.kind === 'closed')
  if (clinicWideClosure) return []

  // ── Step 3: per-provider resolution, mirroring availability.ts. ──
  // Index overrides for fast per-provider lookup. Clinic-wide custom
  // rows apply to EVERY provider (alongside any per-provider customs);
  // per-provider closures override everything else for that provider.
  const clinicWideCustoms = todays.filter(
    o => o.provider_id === null && o.kind === 'custom' && o.start_time && o.end_time,
  )
  const weekday = weekdayOf(dayKey)

  const perProviderOpen: MinuteInterval[][] = []
  for (const pid of providerIds) {
    // Per-provider closure → provider has no open intervals today.
    const closed = todays.some(o => o.provider_id === pid && o.kind === 'closed')
    if (closed) {
      perProviderOpen.push([])
      continue
    }
    // Per-provider customs ∪ clinic-wide customs (if any).
    const customs: MinuteInterval[] = []
    for (const o of todays) {
      const applies = o.provider_id === pid || o.provider_id === null
      if (applies && o.kind === 'custom' && o.start_time && o.end_time) {
        customs.push({ startMin: parseHHMM(o.start_time), endMin: parseHHMM(o.end_time) })
      }
    }
    if (customs.length > 0) {
      perProviderOpen.push(unionIntervals(customs))
      continue
    }
    // Fall through to recurring rules. clinicWideCustoms is empty
    // here (otherwise it would have gone through the customs branch
    // above) — so we just use this provider's weekly rules.
    void clinicWideCustoms // referenced for clarity
    const ruleSet = rules
      .filter(r => r.provider_id === pid && r.weekday === weekday)
      .map(r => ({ startMin: parseHHMM(r.start_time), endMin: parseHHMM(r.end_time) }))
    perProviderOpen.push(unionIntervals(ruleSet))
  }

  // ── Step 4: union across providers. ──
  const flat: MinuteInterval[] = []
  for (const intervals of perProviderOpen) {
    for (const iv of intervals) flat.push(iv)
  }
  return unionIntervals(flat)
}
