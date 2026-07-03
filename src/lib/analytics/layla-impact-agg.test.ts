import { describe, it, expect } from 'vitest'
import { aggregateLaylaImpact, svcPrice } from './layla-impact-agg'

const call = (direction: string, outcome: string | null, contact_id: string | null = null) =>
  ({ direction, outcome, contact_id })
const consult = (status: string, contact_id: string | null = null, priceCents = 0) =>
  ({ status, contact_id, service: { price_cents: priceCents } })

describe('aggregateLaylaImpact', () => {
  it('empty inputs → zeros and null no-show rate', () => {
    const agg = aggregateLaylaImpact([], [])
    expect(agg).toMatchObject({
      callsAnswered: 0, reminderCallsPlaced: 0, messagesCaptured: 0,
      transferredToStaff: 0, bookingsInRange: 0, bookingRevenueCents: 0,
      laylaAssistedBookings: 0, laylaAssistedRevenueCents: 0, noShowRate: null,
    })
    expect(agg.callOutcomes).toEqual([])
  })

  it('splits inbound vs outbound and counts voicemail/transfer outcomes', () => {
    const agg = aggregateLaylaImpact([], [
      call('inbound', 'completed'),
      call('inbound', 'voicemail'),
      call('inbound', 'voicemail'),
      call('inbound', 'transferred'),
      call('outbound', 'completed'),
      call('outbound', 'no_consent'),
    ])
    expect(agg.callsAnswered).toBe(4)
    expect(agg.reminderCallsPlaced).toBe(2)
    expect(agg.messagesCaptured).toBe(2)
    expect(agg.transferredToStaff).toBe(1)
    // outcomes only count INBOUND calls, sorted by count desc
    expect(agg.callOutcomes[0]).toEqual({ outcome: 'voicemail', count: 2 })
    expect(agg.callOutcomes.map(o => o.outcome)).not.toContain('no_consent')
  })

  it('null outcome buckets as completed (same as the dashboard)', () => {
    const agg = aggregateLaylaImpact([], [call('inbound', null)])
    expect(agg.callOutcomes).toEqual([{ outcome: 'completed', count: 1 }])
  })

  it('excludes canceled consults from bookings/revenue but not from the no-show rate denominator', () => {
    const agg = aggregateLaylaImpact([
      consult('scheduled', 'c1', 10_000),
      consult('completed', 'c2', 20_000),
      consult('canceled',  'c3', 99_999),
      consult('no_show',   'c4', 15_000),
    ], [])
    expect(agg.bookingsInRange).toBe(3)                 // canceled excluded
    expect(agg.bookingRevenueCents).toBe(45_000)        // 10k + 20k + 15k
    expect(agg.noShowRate).toBeCloseTo(1 / 2)           // no_show / (completed + no_show)
  })

  it('attributes layla-assisted bookings only to contacts with an INBOUND call in range', () => {
    const agg = aggregateLaylaImpact([
      consult('scheduled', 'caller-1', 30_000),
      consult('scheduled', 'web-only', 50_000),
      consult('scheduled', 'reminded', 20_000),
    ], [
      call('inbound', 'completed', 'caller-1'),
      call('outbound', 'completed', 'reminded'),   // outbound must NOT count as assisted
    ])
    expect(agg.laylaAssistedBookings).toBe(1)
    expect(agg.laylaAssistedRevenueCents).toBe(30_000)
    expect(agg.bookingRevenueCents).toBe(100_000)
  })

  it('svcPrice tolerates object, array, and missing service shapes', () => {
    expect(svcPrice({ service: { price_cents: 500 } })).toBe(500)
    expect(svcPrice({ service: [{ price_cents: 700 }] })).toBe(700)
    expect(svcPrice({ service: null })).toBe(0)
    expect(svcPrice({})).toBe(0)
  })
})

describe('buildDigestEmail', async () => {
  const { buildDigestEmail } = await import('../weekly-digest')
  const emptyAgg = aggregateLaylaImpact([], [])

  it('leads-only week leads with the leads, never "$0 booked across 0 consultations"', () => {
    const { subject, html } = buildDigestEmail('Glow Med Spa', 'Ana', emptyAgg, 4)
    expect(subject).toBe('Glow Med Spa last week: 4 new leads captured')
    expect(subject).not.toContain('$0')
    expect(html).not.toContain('Booked value')     // $0 row suppressed
    expect(html).toContain('New leads captured')
  })

  it('calls week leads with calls + booked value', () => {
    const agg = aggregateLaylaImpact(
      [consult('scheduled', 'c1', 30_000)],
      [call('inbound', 'completed', 'c1')],
    )
    const { subject } = buildDigestEmail('Glow Med Spa', 'Ana', agg, 0)
    expect(subject).toBe('Glow Med Spa last week: 1 call answered, $300 booked')
  })

  it('escapes owner-controlled names in HTML but not in the subject', () => {
    const { subject, html } = buildDigestEmail('<b>Evil & Co</b>', '<i>Ana</i>', emptyAgg, 1)
    expect(html).toContain('&lt;b&gt;Evil &amp; Co&lt;/b&gt;')
    expect(html).not.toContain('<b>Evil')
    expect(html).toContain('&lt;i&gt;Ana&lt;/i&gt;')
    expect(subject).toContain('<b>Evil & Co</b>')  // plain text, raw
  })
})
