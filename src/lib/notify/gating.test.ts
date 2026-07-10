import { describe, it, expect, afterEach, vi } from 'vitest'

// isWhatsAppEnabled just reads env, but whatsapp.ts imports twilio.ts
// (which eagerly inits Stripe). Stub the Twilio surface so this pure
// gating test doesn't drag in the billing client.
vi.mock('@/lib/twilio', () => ({
  getTwilioClient: () => ({}),
  isTwilioConfigured: () => false,
}))

import { isSessionOpen } from './session'
import { isWhatsAppEnabled } from './whatsapp'

describe('WhatsApp 24h session', () => {
  const NOW = 1_760_000_000_000
  it('is closed with no prior inbound', () => {
    expect(isSessionOpen(null, NOW)).toBe(false)
    expect(isSessionOpen(undefined, NOW)).toBe(false)
  })
  it('is open within 24h of the last inbound', () => {
    expect(isSessionOpen(new Date(NOW - 60 * 60 * 1000).toISOString(), NOW)).toBe(true)
  })
  it('is closed past 24h', () => {
    expect(isSessionOpen(new Date(NOW - 25 * 60 * 60 * 1000).toISOString(), NOW)).toBe(false)
  })
})

describe('WHATSAPP_ENABLED gate (rider 2 — off by default everywhere)', () => {
  afterEach(() => { delete process.env.WHATSAPP_ENABLED })
  it('defaults to false when unset', () => {
    delete process.env.WHATSAPP_ENABLED
    expect(isWhatsAppEnabled()).toBe(false)
  })
  it('only the literal "true" enables it', () => {
    process.env.WHATSAPP_ENABLED = 'false'; expect(isWhatsAppEnabled()).toBe(false)
    process.env.WHATSAPP_ENABLED = '1';     expect(isWhatsAppEnabled()).toBe(false)
    process.env.WHATSAPP_ENABLED = 'true';  expect(isWhatsAppEnabled()).toBe(true)
  })
})
