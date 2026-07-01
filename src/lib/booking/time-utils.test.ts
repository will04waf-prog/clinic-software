import { describe, it, expect } from 'vitest'
import {
  parseHHMM, localToUtc, overlapsUtc, unionIntervals, weekdayForLocalDate,
} from './time-utils'

const NY = 'America/New_York'
const t = (iso: string) => new Date(iso)

describe('parseHHMM (audit M6 — strict, matches the DB CHECK)', () => {
  it('parses canonical HH:MM to minutes-of-day', () => {
    expect(parseHHMM('09:00')).toBe(540)
    expect(parseHHMM('00:00')).toBe(0)
    expect(parseHHMM('23:59')).toBe(1439)
    expect(parseHHMM('13:30')).toBe(810)
  })
  it('rejects non-canonical / out-of-range / garbage', () => {
    expect(parseHHMM('9:00')).toBeNull()   // missing leading zero
    expect(parseHHMM('24:00')).toBeNull()
    expect(parseHHMM('12:60')).toBeNull()
    expect(parseHHMM('nope')).toBeNull()
    expect(parseHHMM('')).toBeNull()
    expect(parseHHMM(null)).toBeNull()
    expect(parseHHMM(undefined)).toBeNull()
  })
})

describe('localToUtc (audit M6 — DST wall-clock math)', () => {
  it('EST winter wall-clock → UTC-5', () => {
    expect(localToUtc({ year: 2026, month: 1, day: 15 }, 9 * 60, NY)?.toISOString())
      .toBe('2026-01-15T14:00:00.000Z')
  })
  it('EDT summer wall-clock → UTC-4', () => {
    expect(localToUtc({ year: 2026, month: 7, day: 15 }, 9 * 60, NY)?.toISOString())
      .toBe('2026-07-15T13:00:00.000Z')
  })
  it('returns null for a wall-clock in the spring-forward gap (02:30 on 2026-03-08 does not exist)', () => {
    expect(localToUtc({ year: 2026, month: 3, day: 8 }, 2 * 60 + 30, NY)).toBeNull()
  })
  it('returns null for an invalid time zone', () => {
    expect(localToUtc({ year: 2026, month: 1, day: 15 }, 540, 'Not/AZone')).toBeNull()
  })
})

describe('overlapsUtc (audit M6 — half-open, touching is allowed)', () => {
  it('exactly-adjacent intervals do NOT overlap', () => {
    expect(overlapsUtc(
      t('2026-07-02T14:00:00Z'), t('2026-07-02T14:30:00Z'),
      t('2026-07-02T14:30:00Z'), t('2026-07-02T15:00:00Z'),
    )).toBe(false)
  })
  it('genuinely overlapping intervals collide', () => {
    expect(overlapsUtc(
      t('2026-07-02T14:00:00Z'), t('2026-07-02T14:30:00Z'),
      t('2026-07-02T14:15:00Z'), t('2026-07-02T14:45:00Z'),
    )).toBe(true)
  })
})

describe('unionIntervals + weekdayForLocalDate (audit M6)', () => {
  it('merges adjacent/overlapping intervals and keeps gaps', () => {
    expect(unionIntervals([{ startMin: 540, endMin: 720 }, { startMin: 720, endMin: 1020 }]))
      .toEqual([{ startMin: 540, endMin: 1020 }])
    expect(unionIntervals([{ startMin: 540, endMin: 600 }, { startMin: 780, endMin: 1020 }]))
      .toEqual([{ startMin: 540, endMin: 600 }, { startMin: 780, endMin: 1020 }])
  })
  it('weekdayForLocalDate returns 0=Sunday … 6=Saturday', () => {
    expect(weekdayForLocalDate({ year: 2026, month: 7, day: 5 })).toBe(0) // Sunday
    expect(weekdayForLocalDate({ year: 2026, month: 7, day: 6 })).toBe(1) // Monday
  })
})
