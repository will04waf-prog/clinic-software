import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mutable holders the mocks read (vi.hoisted so the factories can see them).
const h = vi.hoisted(() => ({
  org: null as Record<string, unknown> | null,
  waResult: { ok: true, sid: 'wa1', mode: 'template' } as { ok: boolean; reason?: string; sid?: string; mode?: string },
}))

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: h.org, error: null }) }) }),
    }),
  },
}))
vi.mock('@/lib/twilio', () => ({ sendSMS: vi.fn(async () => ({ provider_id: 'sms1', status: 'sent' })) }))
vi.mock('./whatsapp', () => ({ sendWhatsApp: vi.fn(async () => h.waResult) }))

import { notifyOwner } from './index'
import { sendSMS } from '@/lib/twilio'
import { sendWhatsApp } from './whatsapp'

const alert = { organizationId: 'org1', type: 'job_summary' as const, smsBody: 'hi', templateVariables: ['A', 'B', 'C'] }

beforeEach(() => {
  vi.clearAllMocks()
  h.org = { notification_channel: 'sms', owner_notify_e164: '+13015551234', owner_language: 'en', whatsapp_last_inbound_at: null }
  h.waResult = { ok: true, sid: 'wa1', mode: 'template' }
})

describe('notifyOwner routing', () => {
  it('no-ops when the org has no owner mobile', async () => {
    h.org = { ...h.org!, owner_notify_e164: null }
    await notifyOwner(alert)
    expect(sendSMS).not.toHaveBeenCalled()
    expect(sendWhatsApp).not.toHaveBeenCalled()
  })

  it("channel 'sms' → SMS only, no WhatsApp attempt", async () => {
    h.org = { ...h.org!, notification_channel: 'sms' }
    await notifyOwner(alert)
    expect(sendSMS).toHaveBeenCalledTimes(1)
    expect(sendWhatsApp).not.toHaveBeenCalled()
  })

  it("channel 'whatsapp' + WhatsApp ok → no SMS", async () => {
    h.org = { ...h.org!, notification_channel: 'whatsapp' }
    await notifyOwner(alert)
    expect(sendWhatsApp).toHaveBeenCalledTimes(1)
    expect(sendSMS).not.toHaveBeenCalled()
  })

  it("channel 'whatsapp' + WhatsApp disabled → SMS fallback (rider: never dropped)", async () => {
    h.org = { ...h.org!, notification_channel: 'whatsapp' }
    h.waResult = { ok: false, reason: 'disabled' }
    await notifyOwner(alert)
    expect(sendWhatsApp).toHaveBeenCalledTimes(1)
    expect(sendSMS).toHaveBeenCalledTimes(1)
  })

  it("channel 'both' → one WhatsApp + one SMS", async () => {
    h.org = { ...h.org!, notification_channel: 'both' }
    await notifyOwner(alert)
    expect(sendWhatsApp).toHaveBeenCalledTimes(1)
    expect(sendSMS).toHaveBeenCalledTimes(1)
  })

  it("channel 'both' + WhatsApp fails → still exactly one SMS (no double-send)", async () => {
    h.org = { ...h.org!, notification_channel: 'both' }
    h.waResult = { ok: false, reason: 'send_failed' }
    await notifyOwner(alert)
    expect(sendSMS).toHaveBeenCalledTimes(1)
  })
})
