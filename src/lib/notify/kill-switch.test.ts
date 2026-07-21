import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ──────────────────────────────────────────────────────────
const maybeSingle = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ maybeSingle })),
      })),
    })),
  },
}))

import { clientMessagingBlocked } from './kill-switch'

describe('clientMessagingBlocked', () => {
  beforeEach(() => {
    maybeSingle.mockReset()
  })

  it('true when blocked_at is set', async () => {
    maybeSingle.mockResolvedValue({ data: { client_messaging_blocked_at: '2026-07-21T00:00:00Z' }, error: null })
    expect(await clientMessagingBlocked('org-1')).toBe(true)
  })

  it('false when blocked_at is null', async () => {
    maybeSingle.mockResolvedValue({ data: { client_messaging_blocked_at: null }, error: null })
    expect(await clientMessagingBlocked('org-1')).toBe(false)
  })

  it('false when the org row is missing', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null })
    expect(await clientMessagingBlocked('org-1')).toBe(false)
  })

  it('fails OPEN on query error — a DB hiccup must not stop every tenant', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'boom' } })
    expect(await clientMessagingBlocked('org-1')).toBe(false)
  })
})

// ── notifyClient integration: blocked org sends nothing ────────────
describe('notifyClient kill-switch gate', () => {
  it('returns channel none without touching Twilio when blocked', async () => {
    maybeSingle.mockResolvedValue({ data: { client_messaging_blocked_at: '2026-07-21T00:00:00Z' }, error: null })
    // Twilio env deliberately configured — the gate must fire FIRST.
    vi.stubEnv('WHATSAPP_ENABLED', 'true')
    vi.stubEnv('TWILIO_ACCOUNT_SID', 'ACtest')
    vi.stubEnv('TWILIO_AUTH_TOKEN', 'token')
    vi.stubEnv('TWILIO_WHATSAPP_FROM', 'whatsapp:+15550001111')

    const { notifyClient } = await import('./client')
    const res = await notifyClient({
      orgId: 'org-1',
      toPhone: '+15551234567',
      lang: 'es',
      templateType: 'estimate_ready',
      variables: ['María', 'Rivera'],
      smsBody: 'hola',
      link: 'https://tarhunna.net/aprobar/x',
    })
    expect(res.channel).toBe('none')
    expect(res.link).toBe('https://tarhunna.net/aprobar/x')
    vi.unstubAllEnvs()
  })
})
