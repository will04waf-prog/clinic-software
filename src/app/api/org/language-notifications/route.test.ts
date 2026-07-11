import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// Hoisted mutable state the mocks read at call time.
const h = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  gateDenied: false,
  // Row returned by the authed client's organizations select (GET, and
  // the PATCH current-caller_languages read).
  orgRow: {} as Record<string, unknown> | null,
  // Captured supabaseAdmin update payloads.
  adminUpdates: [] as Record<string, unknown>[],
  adminUpdateError: null as { message: string } | null,
  syncResult: { synced: true } as { synced: boolean; reason?: string },
  syncCalls: [] as { orgId: string }[],
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.user }, error: h.user ? null : { message: 'no session' } }) },
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: h.orgRow, error: null }) }) }),
    }),
  }),
}))

vi.mock('@/lib/auth/roles', () => ({
  OWNER_ONLY: new Set(['owner']),
  requireRole: async () =>
    h.gateDenied
      ? { response: new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }) }
      : { orgId: 'org-1', role: 'owner' },
  isDenied: (g: unknown) => typeof g === 'object' && g !== null && 'response' in g,
}))

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: () => ({
      update: (payload: Record<string, unknown>) => {
        h.adminUpdates.push(payload)
        return { eq: async () => ({ error: h.adminUpdateError }) }
      },
    }),
  },
}))

vi.mock('@/lib/voice-agent/seed-assistants', () => ({
  syncInboundAssistant: vi.fn(async ({ orgId }: { orgId: string }) => {
    h.syncCalls.push({ orgId })
    return h.syncResult
  }),
}))

import { GET, PATCH } from './route'

function patchReq(body: unknown) {
  return new NextRequest('https://tarhunna.net/api/org/language-notifications', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  h.user = { id: 'user-1' }
  h.gateDenied = false
  h.orgRow = {
    caller_languages: ['en'],
    owner_language: 'en',
    notification_channel: 'sms',
    owner_notify_e164: null,
    call_agent_assistant_id: 'asst_1',
  }
  h.adminUpdates = []
  h.adminUpdateError = null
  h.syncResult = { synced: true }
  h.syncCalls = []
})

describe('GET /api/org/language-notifications', () => {
  it('401s without a session', async () => {
    h.user = null
    const res = await GET()
    expect(res.status).toBe(401)
  })

  it('passes through the role-gate denial', async () => {
    h.gateDenied = true
    const res = await GET()
    expect(res.status).toBe(403)
  })

  it('returns the row with defaults for null columns', async () => {
    h.orgRow = { caller_languages: null, owner_language: null, notification_channel: null, owner_notify_e164: null, call_agent_assistant_id: null }
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      caller_languages: ['en'],
      owner_language: 'en',
      notification_channel: 'sms',
      owner_notify_e164: null,
      has_assistant: false,
    })
  })
})

describe('PATCH /api/org/language-notifications — validation', () => {
  it('rejects an empty caller_languages array', async () => {
    const res = await PATCH(patchReq({ caller_languages: [] }))
    expect(res.status).toBe(400)
  })

  it('rejects unknown languages and channels', async () => {
    expect((await PATCH(patchReq({ caller_languages: ['fr'] }))).status).toBe(400)
    expect((await PATCH(patchReq({ notification_channel: 'pigeon' }))).status).toBe(400)
    expect((await PATCH(patchReq({ owner_language: 'pt' }))).status).toBe(400)
  })

  it('rejects duplicate caller languages', async () => {
    const res = await PATCH(patchReq({ caller_languages: ['en', 'en'] }))
    expect(res.status).toBe(400)
  })

  it('rejects a non-E164 owner mobile', async () => {
    const res = await PATCH(patchReq({ owner_notify_e164: '301-962-2856' }))
    expect(res.status).toBe(400)
    expect(h.adminUpdates).toHaveLength(0)
  })

  it('rejects unknown keys (strict schema — vertical stays admin-set)', async () => {
    const res = await PATCH(patchReq({ vertical: 'trades', owner_language: 'en' }))
    expect(res.status).toBe(400)
  })

  it('rejects an empty payload', async () => {
    const res = await PATCH(patchReq({}))
    expect(res.status).toBe(400)
  })
})

describe('PATCH /api/org/language-notifications — save + assistant sync', () => {
  it('saves all four fields and syncs when caller_languages changed', async () => {
    h.orgRow = { caller_languages: ['en'] } // current row read
    const res = await PATCH(patchReq({
      caller_languages: ['en', 'es'],
      owner_language: 'es',
      notification_channel: 'both',
      owner_notify_e164: '+13019622856',
    }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, assistant_synced: true })
    expect(h.adminUpdates[0]).toEqual({
      caller_languages: ['en', 'es'],
      owner_language: 'es',
      notification_channel: 'both',
      owner_notify_e164: '+13019622856',
    })
    expect(h.syncCalls).toEqual([{ orgId: 'org-1' }])
  })

  it('skips the Vapi sync when the language set is unchanged (order-insensitive)', async () => {
    h.orgRow = { caller_languages: ['es', 'en'] }
    const res = await PATCH(patchReq({ caller_languages: ['en', 'es'] }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, assistant_synced: null })
    expect(h.syncCalls).toHaveLength(0)
  })

  it('skips the sync entirely for non-language fields', async () => {
    const res = await PATCH(patchReq({ notification_channel: 'whatsapp', owner_notify_e164: null }))
    expect(res.status).toBe(200)
    expect(h.adminUpdates[0]).toEqual({ notification_channel: 'whatsapp', owner_notify_e164: null })
    expect(h.syncCalls).toHaveLength(0)
  })

  it('save still succeeds when the Vapi sync fails — assistant_synced:false', async () => {
    h.orgRow = { caller_languages: ['en'] }
    h.syncResult = { synced: false, reason: 'vapi_error' }
    const res = await PATCH(patchReq({ caller_languages: ['en', 'es'] }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, assistant_synced: false })
    expect(h.adminUpdates).toHaveLength(1) // DB write landed first
  })

  it('not_seeded orgs get assistant_synced:null (nothing to warn about)', async () => {
    h.orgRow = { caller_languages: ['en'] }
    h.syncResult = { synced: false, reason: 'not_seeded' }
    const res = await PATCH(patchReq({ caller_languages: ['es'] }))
    expect(await res.json()).toEqual({ ok: true, assistant_synced: null })
  })

  it('surfaces DB update failures as 500 and never calls sync', async () => {
    h.orgRow = { caller_languages: ['en'] }
    h.adminUpdateError = { message: 'boom' }
    const res = await PATCH(patchReq({ caller_languages: ['es'] }))
    expect(res.status).toBe(500)
    expect(h.syncCalls).toHaveLength(0)
  })
})
