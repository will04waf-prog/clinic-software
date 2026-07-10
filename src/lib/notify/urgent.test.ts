import { describe, it, expect, beforeEach, vi } from 'vitest'

const h = vi.hoisted(() => ({
  delivered: true,
  owner: { email: 'owner@example.com' } as { email: string } | null,
}))

vi.mock('./index', () => ({ notifyOwner: vi.fn(async () => ({ delivered: h.delivered })) }))
vi.mock('@/lib/resend', () => ({
  sendEmail: vi.fn(async () => {}),
  wrapEmailHtml: (s: string) => s,
}))
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: h.owner }) }) }),
          }),
        }),
      }),
    }),
  },
}))

import { alertOwnerUrgent } from './urgent'
import { notifyOwner } from './index'
import { sendEmail } from '@/lib/resend'

const input = {
  organizationId: 'org1',
  orgName: 'Rivera Landscaping',
  ownerLanguage: 'en' as const,
  callerPhone: '+13015551234',
  issue: 'burst pipe flooding the kitchen',
}

beforeEach(() => {
  vi.clearAllMocks()
  h.delivered = true
  h.owner = { email: 'owner@example.com' }
  process.env.RESEND_API_KEY = 'test-key'
})

describe('flag_urgent alert', () => {
  // This is the bypass-dedupe test called for in the original Phase 4
  // approval: an urgent flag must fire on EVERY call, never deduped.
  it('bypasses dedupe — fires on every call', async () => {
    await alertOwnerUrgent(input)
    await alertOwnerUrgent(input)
    expect(notifyOwner).toHaveBeenCalledTimes(2)   // no dedupe suppression
    expect(sendEmail).not.toHaveBeenCalled()        // phone delivered → no email
  })

  // Rider 1: an urgent flag must never be silent.
  it('urgent with no phone delivered → email fallback fires (rider 1)', async () => {
    h.delivered = false // no owner mobile, or every phone send failed
    await alertOwnerUrgent(input)
    expect(sendEmail).toHaveBeenCalledTimes(1)
    // and the email still bypasses dedupe: two flags → two emails
    await alertOwnerUrgent(input)
    expect(sendEmail).toHaveBeenCalledTimes(2)
  })

  // Rider 2: the body must carry the caller number + issue for one-tap
  // callback, on every channel.
  it('body carries the caller number and stated issue (rider 2)', async () => {
    await alertOwnerUrgent(input)
    const call = (notifyOwner as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as {
      type: string; smsBody: string; templateVariables: string[]
    }
    expect(call.type).toBe('urgent_alert')
    expect(call.smsBody).toContain('+13015551234')
    expect(call.smsBody).toContain('burst pipe flooding the kitchen')
    expect(call.templateVariables).toEqual(['Rivera Landscaping', '+13015551234', 'burst pipe flooding the kitchen'])
  })
})
