import { describe, it, expect, beforeEach, vi } from 'vitest'

// Owner-facing output follows owner_language, independent of the call's
// language: a Spanish-speaking owner gets a Spanish summary even for an
// English call, and vice-versa (Phase 2 rider).
const h = vi.hoisted(() => ({ ownerLang: 'en' as 'en' | 'es' }))

vi.mock('@/lib/notify', () => ({ notifyOwner: vi.fn(async () => ({ delivered: true })) }))
vi.mock('@/lib/voice-agent/app-url', () => ({ getAppUrl: () => 'https://tarhunna.net' }))
vi.mock('@/lib/resend', () => ({ sendEmail: vi.fn(async () => {}), wrapEmailHtml: (s: string) => s }))
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: (t: string) => {
      if (t === 'profiles') {
        return { select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: { email: 'o@x.com', full_name: 'O' } }) }) }) }) }) }) }
      }
      if (t === 'organizations') {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: { name: 'Rivera', owner_language: h.ownerLang } }) }) }) }
      }
      // activity_log dedupe-claim insert → success
      return { insert: async () => ({ error: null }) }
    },
  },
}))

import { notifyOwnerOfCallSummary } from './call-summary-notification'
import { sendEmail } from '@/lib/resend'

beforeEach(() => {
  vi.clearAllMocks()
  process.env.RESEND_API_KEY = 'test-key'
})

describe('owner-language rendering (Phase 2)', () => {
  it('Spanish owner gets a Spanish summary of a call', async () => {
    h.ownerLang = 'es'
    await notifyOwnerOfCallSummary({ organizationId: 'org1', callSid: 'CA1', disposition: 'booked' })
    const arg = (sendEmail as unknown as { mock: { calls: { subject: string; html: string }[][] } }).mock.calls[0][0]
    expect(arg.subject).toContain('Resumen de llamada')
    expect(arg.subject).toContain('reservada')          // 'booked' → ES label
    expect(arg.html).toContain('Llamada completada')
  })

  it('English owner gets an English summary', async () => {
    h.ownerLang = 'en'
    await notifyOwnerOfCallSummary({ organizationId: 'org1', callSid: 'CA2', disposition: 'booked' })
    const arg = (sendEmail as unknown as { mock: { calls: { subject: string; html: string }[][] } }).mock.calls[0][0]
    expect(arg.subject).toContain('Call summary')
    expect(arg.html).toContain('Call completed')
  })
})
