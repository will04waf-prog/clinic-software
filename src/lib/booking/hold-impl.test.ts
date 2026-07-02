import { describe, it, expect } from 'vitest'
import { holdInputSchema } from './hold-impl'

const valid = {
  orgId: '11111111-2222-4333-8444-555555555555',
  serviceId: '22222222-2222-4333-8444-555555555555',
  providerId: '33333333-2222-4333-8444-555555555555',
  slotStartUtc: '2026-07-06T14:00:00.000Z',
  name: 'Sofia Martinez',
  phone: '+1 (415) 555-0162',
  smsConsent: true,
}

describe('holdInputSchema (audit M9 — money + PHI + TCPA input boundary)', () => {
  it('accepts a well-formed hold', () => {
    expect(holdInputSchema.safeParse(valid).success).toBe(true)
  })

  it('requires smsConsent to be literally true (TCPA)', () => {
    expect(holdInputSchema.safeParse({ ...valid, smsConsent: false }).success).toBe(false)
    const { smsConsent, ...noConsent } = valid
    void smsConsent
    expect(holdInputSchema.safeParse(noConsent).success).toBe(false)
  })

  it('rejects a bogus phone or empty/garbage name', () => {
    expect(holdInputSchema.safeParse({ ...valid, phone: 'call me' }).success).toBe(false)
    expect(holdInputSchema.safeParse({ ...valid, phone: '123' }).success).toBe(false) // < 7 chars
    expect(holdInputSchema.safeParse({ ...valid, name: '' }).success).toBe(false)
    expect(holdInputSchema.safeParse({ ...valid, name: '<script>' }).success).toBe(false)
  })

  it('rejects non-uuid service/provider ids', () => {
    expect(holdInputSchema.safeParse({ ...valid, serviceId: 'nope' }).success).toBe(false)
    expect(holdInputSchema.safeParse({ ...valid, providerId: 'nope' }).success).toBe(false)
  })

  it('accepts an optional empty email but rejects a malformed one', () => {
    expect(holdInputSchema.safeParse({ ...valid, email: '' }).success).toBe(true)
    expect(holdInputSchema.safeParse({ ...valid, email: 'a@b.co' }).success).toBe(true)
    expect(holdInputSchema.safeParse({ ...valid, email: 'not-an-email' }).success).toBe(false)
  })
})
