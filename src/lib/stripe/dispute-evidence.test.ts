import { describe, it, expect } from 'vitest'
import { buildDisputeEvidence } from './dispute-evidence'

const FULL = {
  businessName: 'Jardinería García',
  customerName: 'María López',
  customerEmail: 'maria@example.com',
  customerPhone: '+13055550123',
  invoiceNumber: 7,
  invoiceTitle: 'Corte y limpieza',
  totalCents: 15_000,
  estimateNumber: 12,
  approvedAt: '2026-07-12T18:03:21.000Z',
  approvedIp: '203.0.113.9',
  serviceDate: '2026-07-15',
}

describe('buildDisputeEvidence', () => {
  it('composes the full approval record (timestamp + IP + estimate #)', () => {
    const e = buildDisputeEvidence(FULL)
    expect(e.customer_name).toBe('María López')
    expect(e.customer_email_address).toBe('maria@example.com')
    expect(e.customer_purchase_ip).toBe('203.0.113.9')
    expect(e.service_date).toBe('2026-07-15')
    expect(e.uncategorized_text).toContain('Estimate #12')
    expect(e.uncategorized_text).toContain('2026-07-12 18:03 UTC')
    expect(e.uncategorized_text).toContain('203.0.113.9')
    expect(e.uncategorized_text).toContain('+13055550123')
    expect(e.uncategorized_text).toContain('Invoice #7')
    expect(e.uncategorized_text).toContain('$150.00')
    expect(e.product_description).toContain('Invoice #7')
  })

  it('from-scratch invoice (no estimate approval): no IP field, no approval claim', () => {
    const e = buildDisputeEvidence({
      businessName: 'Jardinería García',
      customerName: 'María López',
      invoiceNumber: 9,
      totalCents: 8_000,
    })
    expect(e.customer_purchase_ip).toBeUndefined()
    expect(e.uncategorized_text).not.toContain('approved')
    expect(e.uncategorized_text).toContain('Invoice #9')
    expect(e.uncategorized_text).toContain('$80.00')
  })

  it('drops empty optional fields instead of sending blanks', () => {
    const e = buildDisputeEvidence({
      businessName: 'X',
      customerName: '',
      customerEmail: null,
      invoiceNumber: 1,
      totalCents: 100,
    })
    expect('customer_name' in e).toBe(false)
    expect('customer_email_address' in e).toBe(false)
    expect('service_date' in e).toBe(false)
  })

  it('survives an unparseable approval timestamp by echoing it raw', () => {
    const e = buildDisputeEvidence({ ...FULL, approvedAt: 'weird-timestamp' })
    expect(e.uncategorized_text).toContain('weird-timestamp')
  })
})
