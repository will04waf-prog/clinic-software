import { describe, it, expect } from 'vitest'
import { applicationFeeCents, PLATFORM_FEE_BPS, CRM_PLAN } from './connect-fees'

describe('applicationFeeCents (1% platform fee on client card payments)', () => {
  it('is 1% of the total', () => {
    expect(applicationFeeCents(10_000)).toBe(100) // $100 → $1.00
    expect(applicationFeeCents(3_900)).toBe(39)   // $39   → $0.39
    expect(applicationFeeCents(100)).toBe(1)      // $1    → $0.01
  })

  it('rounds to the nearest cent', () => {
    expect(applicationFeeCents(12_345)).toBe(123) // 123.45 → 123
    expect(applicationFeeCents(12_355)).toBe(124) // 123.55 → 124
    expect(applicationFeeCents(150)).toBe(2)      // 1.5 → 2 (round half up)
  })

  it('never goes negative or NaN on bad input', () => {
    expect(applicationFeeCents(0)).toBe(0)
    expect(applicationFeeCents(-500)).toBe(0)
    expect(applicationFeeCents(NaN)).toBe(0)
    expect(applicationFeeCents(Infinity)).toBe(0)
  })

  it('derives from the locked bps constant, not a hardcoded 100', () => {
    expect(PLATFORM_FEE_BPS).toBe(100)
    // A $250.00 job: fee tracks the constant.
    expect(applicationFeeCents(25_000)).toBe(Math.round((25_000 * PLATFORM_FEE_BPS) / 10_000))
  })
})

describe('CRM_PLAN (SaaS subscription)', () => {
  it('is $39/mo with a 14-day trial', () => {
    expect(CRM_PLAN.monthlyPriceCents).toBe(3900)
    expect(CRM_PLAN.trialDays).toBe(14)
  })
})
