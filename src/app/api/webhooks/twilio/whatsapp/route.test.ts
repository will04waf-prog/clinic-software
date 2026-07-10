import { describe, it, expect, beforeEach, vi } from 'vitest'

const h = vi.hoisted(() => ({ sigValid: false, orgs: [] as { id: string; owner_notify_e164: string }[] }))

vi.mock('@/lib/twilio', () => ({
  verifyTwilioSignature: vi.fn(() => h.sigValid),
  twimlResponse: (body: string) => new Response(body, { status: 200, headers: { 'Content-Type': 'text/xml' } }),
}))
vi.mock('@/lib/notify/session', () => ({ stampWhatsAppInbound: vi.fn(async () => {}) }))
vi.mock('@/lib/validators', () => ({ normalizePhone: (s: string) => s }))
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: () => ({ select: () => ({ ilike: () => ({ limit: async () => ({ data: h.orgs }) }) }) }),
  },
}))

import { POST } from './route'
import { stampWhatsAppInbound } from '@/lib/notify/session'

function waRequest(from = 'whatsapp:+13015551234') {
  return new Request('https://tarhunna.net/api/webhooks/twilio/whatsapp', {
    method: 'POST',
    body: new URLSearchParams({ From: from, Body: 'OK' }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.sigValid = false
  h.orgs = []
})

describe('inbound WhatsApp webhook (rider 1 — signed only)', () => {
  it('rejects an unsigned/forged request with 403 and never stamps', async () => {
    h.sigValid = false
    h.orgs = [{ id: 'org1', owner_notify_e164: '+13015551234' }]
    const res = await POST(waRequest())
    expect(res.status).toBe(403)
    expect(stampWhatsAppInbound).not.toHaveBeenCalled()
  })

  it('accepts a valid signature and stamps the matching org session', async () => {
    h.sigValid = true
    h.orgs = [{ id: 'org1', owner_notify_e164: '+13015551234' }]
    const res = await POST(waRequest())
    expect(res.status).toBe(200)
    expect(stampWhatsAppInbound).toHaveBeenCalledWith('org1')
  })

  it('valid signature but unknown owner number → 200, no stamp', async () => {
    h.sigValid = true
    h.orgs = []
    const res = await POST(waRequest('whatsapp:+19998887777'))
    expect(res.status).toBe(200)
    expect(stampWhatsAppInbound).not.toHaveBeenCalled()
  })
})
