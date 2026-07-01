import { describe, it, expect } from 'vitest'
import { computeAvailableSlots } from './availability'
import type { AvailabilityInput } from './types'

const NY = 'America/New_York'

// Monday 2026-07-06, bracketed in clinic-local ET. Provider open Mon 09:00–17:00,
// 30-min service, 15-min after-buffer. `now` is well before the window so lead
// time never clamps.
const base = (o: Partial<AvailabilityInput> = {}): AvailabilityInput => ({
  fromUtc: new Date('2026-07-06T04:00:00Z'), // Mon 00:00 ET
  toUtc:   new Date('2026-07-07T04:00:00Z'), // Mon 24:00 ET
  timezone: NY,
  service: { id: 'svc', durationMin: 30, leadTimeHours: 0, bookingHorizonDays: 60 },
  providers: [{ id: 'prov', bufferBeforeMin: 0, bufferAfterMin: 15 }],
  rules: [{ providerId: 'prov', weekday: 1, startTime: '09:00', endTime: '17:00' }],
  overrides: [],
  existingBookings: [],
  now: new Date('2026-07-01T00:00:00Z'),
  ...o,
})

const has = (slots: { startUtc: string }[], iso: string) => slots.some((s) => s.startUtc === iso)

describe('computeAvailableSlots (audit M2 / M3 / M6)', () => {
  it('offers in-hours slots on an open weekday', () => {
    const slots = computeAvailableSlots(base())
    expect(has(slots, '2026-07-06T14:00:00.000Z')).toBe(true) // Mon 10:00 ET
    expect(slots.length).toBeGreaterThan(0)
  })

  it('offers NO slots on a weekday with no availability rule (closed day)', () => {
    // Sunday 2026-07-05 window; the only rule is for Monday(1).
    const slots = computeAvailableSlots(base({
      fromUtc: new Date('2026-07-05T04:00:00Z'),
      toUtc:   new Date('2026-07-06T03:00:00Z'),
    }))
    expect(slots).toHaveLength(0)
  })

  it('offers NO slots on a date with a clinic-wide "closed" override', () => {
    const slots = computeAvailableSlots(base({
      overrides: [{ providerId: null, kind: 'closed', date: '2026-07-06', startTime: null, endTime: null }],
    }))
    expect(slots).toHaveLength(0)
  })

  it('does NOT offer a slot whose after-buffer collides with a later booking (M3 — the reschedule/hold gap)', () => {
    // Existing 14:30–15:00 ET (18:30–19:00 UTC). Provider needs 15 min after each visit.
    const slots = computeAvailableSlots(base({
      existingBookings: [{
        providerId: 'prov',
        startUtc: new Date('2026-07-06T18:30:00.000Z'),
        endUtc:   new Date('2026-07-06T19:00:00.000Z'),
      }],
    }))
    // 14:00 ET (18:00 UTC): its 15-min after-buffer runs to 14:45, overlapping the
    // 14:30 booking → NOT offered. The DB EXCLUDE constraint alone would have
    // allowed a reschedule/hold here (raw ranges are merely adjacent).
    expect(has(slots, '2026-07-06T18:00:00.000Z')).toBe(false)
    // 13:45 ET (17:45 UTC): after-buffer ends exactly at 14:30 (half-open) → still offered.
    expect(has(slots, '2026-07-06T17:45:00.000Z')).toBe(true)
  })
})
