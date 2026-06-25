/**
 * Phase 4 W1 — pure availability engine.
 *
 * Inputs are everything the engine needs: clinic timezone,
 * service shape, providers (with buffers), recurring rules,
 * one-off overrides, and already-held/booked rows. Output is
 * the sorted, de-duplicated list of free slots.
 *
 * The engine is pure: no DB access, no Supabase imports, no
 * Twilio, no clock. `now` is injected so tests are
 * deterministic. The HTTP layer
 * (src/app/api/booking/availability/route.ts, owned by Agent C)
 * does the I/O and then calls computeAvailableSlots.
 *
 * The algorithm in five steps:
 *
 *   1. Clamp the search window to honor the service's lead
 *      time and booking horizon.
 *
 *   2. Enumerate clinic-local calendar dates and, for each
 *      (provider, date), compute the OPEN INTERVALS in
 *      minutes-of-day. The rule set is the baseline; overrides
 *      modify it per the precedence in the migration's
 *      availability_overrides comment.
 *
 *   3. Convert each clinic-local interval to a UTC interval
 *      via localToUtc(), which iteratively probes wall-clock
 *      parts in the target zone. DST shifts just work — the
 *      same pattern as quiet-hours.ts.
 *
 *   4. For each provider, walk slotStepMin increments inside
 *      the UTC intervals and test each candidate against
 *      (a) interval containment, (b) buffer-padded overlap
 *      with existing bookings, (c) the clamped window.
 *
 *   5. Group candidates by startUtc across providers and emit
 *      sorted SlotResults.
 */

import type {
  AvailabilityInput,
  ExistingBooking,
  OverrideForEngine,
  ProviderForEngine,
  RuleForEngine,
  SlotResult,
} from './types'
import {
  dateKey,
  enumerateLocalDates,
  localToUtc,
  overlapsUtc,
  parseHHMM,
  unionIntervals,
  weekdayForLocalDate,
  type LocalParts,
  type MinuteInterval,
} from './time-utils'

/** Default grid step in minutes if the caller does not override. */
const DEFAULT_SLOT_STEP_MIN = 15

/** Hard cap to keep pathological inputs from blowing up CPU. */
const MAX_DAYS = 366

interface UtcInterval {
  startUtc: Date
  endUtc:   Date
}

interface ProviderDayPlan {
  providerId:   string
  /** Clinic-local intervals in minutes-of-day for that date. */
  localOpen:    MinuteInterval[]
  /** Those same intervals materialized as concrete UTC ranges. */
  utcOpen:      UtcInterval[]
}

/**
 * Compute every bookable slot in the requested window.
 *
 * Returns [] for any unrecoverable input (empty providers,
 * inverted window after clamping, etc). The caller is
 * expected to render an "no times available" empty state.
 */
export function computeAvailableSlots(input: AvailabilityInput): SlotResult[] {
  const {
    timezone,
    service,
    providers,
    rules,
    overrides,
    existingBookings,
    now,
  } = input
  const slotStepMin = input.slotStepMin ?? DEFAULT_SLOT_STEP_MIN

  if (!timezone) return []
  if (providers.length === 0) return []
  if (!Number.isFinite(service.durationMin) || service.durationMin <= 0) return []
  if (slotStepMin <= 0) return []

  // ── Step 1 — clamp the window. ───────────────────────────
  const leadMs    = service.leadTimeHours      * 60 * 60 * 1000
  const horizonMs = service.bookingHorizonDays * 24 * 60 * 60 * 1000
  const effectiveFromUtc = new Date(Math.max(input.fromUtc.getTime(), now.getTime() + leadMs))
  const effectiveToUtc   = new Date(Math.min(input.toUtc.getTime(),   now.getTime() + horizonMs))
  if (effectiveFromUtc.getTime() >= effectiveToUtc.getTime()) return []

  // ── Step 2 — enumerate dates and build per-(provider, date)
  // open lists. We expand a one-day safety margin on each end
  // because a clinic-local date overlaps two UTC calendar days
  // and the engine works in UTC.
  const enumFrom = new Date(effectiveFromUtc.getTime() - 24 * 60 * 60 * 1000)
  const enumTo   = new Date(effectiveToUtc.getTime()   + 24 * 60 * 60 * 1000)
  const localDates = enumerateLocalDates(enumFrom, enumTo, timezone)
  if (localDates.length === 0 || localDates.length > MAX_DAYS) return []

  // Pre-bucket inputs for O(1)/O(small) lookups inside the
  // per-date loops.
  const rulesByProviderWeekday = bucketRules(rules)
  const overridesByDate        = bucketOverridesByDate(overrides)
  const bookingsByProvider     = bucketBookingsByProvider(existingBookings)

  const plans: ProviderDayPlan[] = []
  for (const localDate of localDates) {
    const weekday = weekdayForLocalDate(localDate)
    const key     = dateKey(localDate)
    const todays  = overridesByDate.get(key) ?? []

    // Clinic-wide closure short-circuits every provider.
    const clinicWideClosed = todays.some(o => o.providerId === null && o.kind === 'closed')

    for (const provider of providers) {
      let localOpen: MinuteInterval[]

      if (clinicWideClosed) {
        localOpen = []
      } else {
        const providerOverrides = todays.filter(o => o.providerId === provider.id || o.providerId === null)
        const providerClosed    = providerOverrides.some(o => o.kind === 'closed')
        if (providerClosed) {
          localOpen = []
        } else {
          const customRows = providerOverrides.filter(o => o.kind === 'custom')
          if (customRows.length > 0) {
            // Custom overrides REPLACE rules for this date.
            localOpen = unionIntervals(
              customRows
                .map(o => makeIntervalFromHHMM(o.startTime, o.endTime))
                .filter((v): v is MinuteInterval => v !== null),
            )
          } else {
            // No override → fall back to the weekly rules.
            const matched = rulesByProviderWeekday.get(`${provider.id}:${weekday}`) ?? []
            localOpen = unionIntervals(
              matched
                .map(r => makeIntervalFromHHMM(r.startTime, r.endTime))
                .filter((v): v is MinuteInterval => v !== null),
            )
          }
        }
      }

      // ── Step 3 — materialize as UTC intervals. ──────────
      const utcOpen: UtcInterval[] = []
      for (const iv of localOpen) {
        const startUtc = localToUtc(localDate, iv.startMin, timezone)
        const endUtc   = localToUtc(localDate, iv.endMin,   timezone)
        if (!startUtc || !endUtc) continue
        if (endUtc.getTime() <= startUtc.getTime()) continue
        utcOpen.push({ startUtc, endUtc })
      }

      plans.push({ providerId: provider.id, localOpen, utcOpen })
    }
  }

  // ── Step 4 — walk slot grid per provider. ────────────────
  const stepMs     = slotStepMin       * 60 * 1000
  const durationMs = service.durationMin * 60 * 1000

  // Map keyed by ISO startUtc → providerIds set. Using string
  // keys (the ISO) gives us stable ordering after sort and
  // natural de-duplication across providers.
  const candidateByStart = new Map<string, Set<string>>()

  const providersById = new Map<string, ProviderForEngine>()
  for (const p of providers) providersById.set(p.id, p)

  for (const plan of plans) {
    const provider = providersById.get(plan.providerId)
    if (!provider) continue
    const bookings = bookingsByProvider.get(plan.providerId) ?? []

    for (const interval of plan.utcOpen) {
      // Floor the first candidate up to the slot grid relative
      // to the interval start so slots align to wall-clock-
      // friendly multiples of slotStepMin (e.g. :00/:15/:30/:45).
      // (We use interval start as the anchor so a 09:07 opening
      // — uncommon but legal — still produces 09:07, 09:22, …)
      let candidate = interval.startUtc.getTime()

      // Honor the clamped window's lower bound.
      if (candidate < effectiveFromUtc.getTime()) {
        const delta = effectiveFromUtc.getTime() - candidate
        const steps = Math.ceil(delta / stepMs)
        candidate = candidate + steps * stepMs
      }

      while (candidate + durationMs <= interval.endUtc.getTime()) {
        const slotStart = new Date(candidate)
        const slotEnd   = new Date(candidate + durationMs)

        if (slotEnd.getTime() > effectiveToUtc.getTime()) break

        // (b) buffer-padded overlap against existing bookings.
        const bufferedStart = new Date(candidate - provider.bufferBeforeMin * 60 * 1000)
        const bufferedEnd   = new Date(candidate + durationMs + provider.bufferAfterMin * 60 * 1000)

        let collides = false
        for (const b of bookings) {
          if (overlapsUtc(bufferedStart, bufferedEnd, b.startUtc, b.endUtc)) {
            collides = true
            break
          }
        }

        if (!collides) {
          const iso = slotStart.toISOString()
          let bucket = candidateByStart.get(iso)
          if (!bucket) {
            bucket = new Set()
            candidateByStart.set(iso, bucket)
          }
          bucket.add(provider.id)
        }

        candidate += stepMs
      }
    }
  }

  // ── Step 5 — sort + emit. ────────────────────────────────
  const out: SlotResult[] = []
  const sortedStarts = Array.from(candidateByStart.keys()).sort()
  for (const startIso of sortedStarts) {
    const providerIds = Array.from(candidateByStart.get(startIso) ?? []).sort()
    const startUtc    = new Date(startIso)
    const endUtc      = new Date(startUtc.getTime() + durationMs)
    out.push({
      startUtc: startIso,
      endUtc:   endUtc.toISOString(),
      providerIds,
    })
  }
  return out
}

// ────────────────────────────────────────────────────────────
// Bucketing helpers — pure, named for readability.
// ────────────────────────────────────────────────────────────

function bucketRules(rules: RuleForEngine[]): Map<string, RuleForEngine[]> {
  const m = new Map<string, RuleForEngine[]>()
  for (const r of rules) {
    const key = `${r.providerId}:${r.weekday}`
    const arr = m.get(key) ?? []
    arr.push(r)
    m.set(key, arr)
  }
  return m
}

function bucketOverridesByDate(overrides: OverrideForEngine[]): Map<string, OverrideForEngine[]> {
  const m = new Map<string, OverrideForEngine[]>()
  for (const o of overrides) {
    const arr = m.get(o.date) ?? []
    arr.push(o)
    m.set(o.date, arr)
  }
  return m
}

function bucketBookingsByProvider(bookings: ExistingBooking[]): Map<string, ExistingBooking[]> {
  const m = new Map<string, ExistingBooking[]>()
  for (const b of bookings) {
    const arr = m.get(b.providerId) ?? []
    arr.push(b)
    m.set(b.providerId, arr)
  }
  return m
}

function makeIntervalFromHHMM(start: string | null, end: string | null): MinuteInterval | null {
  const s = parseHHMM(start)
  const e = parseHHMM(end)
  if (s === null || e === null) return null
  if (e <= s) return null
  return { startMin: s, endMin: e }
}

// Re-export the LocalParts shape so callers (tests, future
// admin UI previews) can build inputs without reaching into
// time-utils directly.
export type { LocalParts }
