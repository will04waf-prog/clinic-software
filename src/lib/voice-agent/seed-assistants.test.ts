import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  ensureInboundAssistant,
  ensureReminderAssistant,
  buildInboundAssistantBody,
  buildReminderAssistantBody,
} from './seed-assistants'

const ORG = { id: 'org-1', name: 'Glow Med Spa', slug: 'glow-med-spa' }
const APP_URL = 'https://tarhunna.net'

// Minimal chainable Supabase stub. `orgRows` is a queue consumed by
// successive select().single() calls (the race path re-reads the org);
// `updates` records update() payloads; `stampedRows` is what the
// conditional-stamp .select() resolves to ([] simulates a lost race).
function fakeSupabase(
  orgRows: (Record<string, unknown> | null)[],
  opts: { updateError?: { message: string } | null; stampedRows?: unknown[] } = {},
) {
  const updates: Record<string, unknown>[] = []
  const { updateError = null, stampedRows = [{}] } = opts
  let readIdx = 0
  const updateChain = {
    is: () => updateChain,
    eq: () => updateChain,
    select: async () => ({ data: stampedRows, error: updateError }),
  }
  const client = {
    updates,
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => {
            const row = orgRows[Math.min(readIdx++, orgRows.length - 1)] ?? null
            return { data: row, error: row ? null : { message: 'not found' } }
          },
        }),
      }),
      update: (payload: Record<string, unknown>) => {
        updates.push(payload)
        return { eq: () => updateChain }
      },
    }),
  }
  return client
}

function stubVapi(assistantId = 'asst_new') {
  const calls: { url: string; body: any }[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) })
    return new Response(JSON.stringify({ id: assistantId }), { status: 201 })
  }))
  return calls
}

beforeEach(() => {
  process.env.VAPI_API_KEY = 'test-key'
  process.env.VAPI_WEBHOOK_SECRET = 'test-secret'
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.VAPI_API_KEY
  delete process.env.VAPI_WEBHOOK_SECRET
})

describe('ensureInboundAssistant', () => {
  it('short-circuits without calling Vapi when the org is already seeded', async () => {
    const calls = stubVapi()
    const supabase = fakeSupabase([{ ...ORG, call_agent_assistant_id: 'asst_existing' }])
    const res = await ensureInboundAssistant({ supabase, orgId: ORG.id, appUrl: APP_URL })
    expect(res).toEqual({ assistantId: 'asst_existing', created: false })
    expect(calls).toHaveLength(0)
    expect(supabase.updates).toHaveLength(0)
  })

  it('creates and stamps when the org has no assistant', async () => {
    const calls = stubVapi('asst_fresh')
    const supabase = fakeSupabase([{ ...ORG, call_agent_assistant_id: null }])
    const res = await ensureInboundAssistant({ supabase, orgId: ORG.id, appUrl: APP_URL })
    expect(res).toEqual({ assistantId: 'asst_fresh', created: true })
    expect(calls[0].url).toBe('https://api.vapi.ai/assistant')
    expect(supabase.updates[0]).toMatchObject({ call_agent_assistant_id: 'asst_fresh' })
  })

  it('forceNew mints a fresh assistant even when one exists (CLI re-seed)', async () => {
    const calls = stubVapi('asst_v2')
    const supabase = fakeSupabase([{ ...ORG, call_agent_assistant_id: 'asst_v1' }])
    const res = await ensureInboundAssistant({ supabase, orgId: ORG.id, appUrl: APP_URL, forceNew: true })
    expect(res).toEqual({ assistantId: 'asst_v2', created: true })
    expect(calls).toHaveLength(1)
  })

  it('refuses to seed against localhost', async () => {
    const supabase = fakeSupabase([{ ...ORG, call_agent_assistant_id: null }])
    await expect(
      ensureInboundAssistant({ supabase, orgId: ORG.id, appUrl: 'http://localhost:3000' }),
    ).rejects.toThrow(/localhost/)
  })

  it('throws a clear error when VAPI_API_KEY is missing', async () => {
    delete process.env.VAPI_API_KEY
    const supabase = fakeSupabase([{ ...ORG, call_agent_assistant_id: null }])
    await expect(
      ensureInboundAssistant({ supabase, orgId: ORG.id, appUrl: APP_URL }),
    ).rejects.toThrow(/VAPI_API_KEY/)
  })

  it('surfaces Vapi rejections with status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad body', { status: 400 })))
    const supabase = fakeSupabase([{ ...ORG, call_agent_assistant_id: null }])
    await expect(
      ensureInboundAssistant({ supabase, orgId: ORG.id, appUrl: APP_URL }),
    ).rejects.toThrow(/400/)
  })

  it('lost race: conditional stamp matches 0 rows → returns the winner id, created:false', async () => {
    stubVapi('asst_loser')
    // First read: null (both requests passed the check); re-read after
    // losing the stamp race: the winner's id is on the org.
    const supabase = fakeSupabase(
      [
        { ...ORG, call_agent_assistant_id: null },
        { ...ORG, call_agent_assistant_id: 'asst_winner' },
      ],
      { stampedRows: [] },
    )
    const res = await ensureInboundAssistant({ supabase, orgId: ORG.id, appUrl: APP_URL })
    expect(res).toEqual({ assistantId: 'asst_winner', created: false })
  })
})

describe('ensureReminderAssistant', () => {
  it('stamps call_agent_reminder_assistant_id, not the inbound column', async () => {
    stubVapi('asst_rem')
    const supabase = fakeSupabase([{ ...ORG, call_agent_reminder_assistant_id: null }])
    const res = await ensureReminderAssistant({ supabase, orgId: ORG.id, appUrl: APP_URL })
    expect(res).toEqual({ assistantId: 'asst_rem', created: true })
    expect(supabase.updates[0]).toHaveProperty('call_agent_reminder_assistant_id', 'asst_rem')
    expect(supabase.updates[0]).not.toHaveProperty('call_agent_assistant_id')
  })

  it('short-circuits when already seeded', async () => {
    const calls = stubVapi()
    const supabase = fakeSupabase([{ ...ORG, call_agent_reminder_assistant_id: 'asst_rem_1' }])
    const res = await ensureReminderAssistant({ supabase, orgId: ORG.id, appUrl: APP_URL })
    expect(res).toEqual({ assistantId: 'asst_rem_1', created: false })
    expect(calls).toHaveLength(0)
  })
})

describe('assistant bodies', () => {
  it('inbound ships all 16 tools wired to /api/voice/tool/*', () => {
    const body = buildInboundAssistantBody(ORG, APP_URL, 'sec')
    expect(body.model.tools).toHaveLength(16)
    for (const t of body.model.tools) {
      expect(t.server.url).toMatch(/^https:\/\/tarhunna\.net\/api\/voice\/tool\//)
      expect(t.server.secret).toBe('sec')
    }
    expect(body.serverMessages).toContain('end-of-call-report')
  })

  it('reminder ships exactly the curated 7-tool subset', () => {
    const body = buildReminderAssistantBody(ORG, APP_URL, 'sec')
    const names = body.model.tools.map((t: any) => t.function.name).sort()
    expect(names).toEqual([
      'cancel_appointment',
      'confirm_appointment',
      'get_context',
      'lookup_availability',
      'post_call_summary_email',
      'reschedule_appointment',
      'take_message',
    ])
    expect(body.metadata.role).toBe('reminder')
  })
})

describe('multi-vertical config (Phase 1)', () => {
  // ORG has no vertical / caller_languages → exercises the defaults
  // path (medspa / {en}), which must reproduce the prior body exactly.
  it('med-spa defaults are byte-identical to the pre-multi-vertical body', () => {
    const body = buildInboundAssistantBody(ORG, APP_URL, 'sec')
    expect(body.voice).toEqual({ provider: 'vapi', voiceId: 'Savannah' })
    expect(body.transcriber).toEqual({ provider: 'deepgram', model: 'nova-2', language: 'en' })
    expect(body.model.tools).toHaveLength(16)
    const sys = (body.model.messages[0].content as string)
    expect(sys).toContain('# Layla — Tarhunna voice receptionist') // base prompt
    expect(sys).not.toMatch(/# Vertical:/)                          // no fragment appended
    expect(body.firstMessage).toBe(
      'Thanks for calling Glow Med Spa, this is Layla! Just so you know, this call may be recorded. What can I do for you today?',
    )
  })

  it('bilingual trades: Spanish voice, multilingual transcriber, trades fragment, flag_urgent (Phase 4)', () => {
    const trades = { ...ORG, vertical: 'trades', caller_languages: ['en', 'es'] }
    const body = buildInboundAssistantBody(trades, APP_URL, 'sec')
    expect(body.transcriber).toMatchObject({ language: 'multi' })
    expect((body.voice as { provider: string }).provider).not.toBe('vapi') // not Savannah
    expect((body.model.messages[0].content as string)).toContain('# Vertical: home & trade services')
    const names = body.model.tools.map((t: any) => t.function.name)
    expect(names).toContain('flag_urgent')  // Phase 4: trades-only urgency tool
    expect(names).toHaveLength(17)           // base 16 + flag_urgent
    // Phase 2: bilingual directive appended for es-capable lines
    const sys = (body.model.messages[0].content as string)
    expect(sys).toContain('# Bilingual — English & Spanish')
    expect(sys).toContain('FOLLOW their most recent language') // code-switch rule
  })

  it('med-spa NEVER gets flag_urgent (vertical-gated)', () => {
    const names = buildInboundAssistantBody(ORG, APP_URL, 'sec').model.tools.map((t: any) => t.function.name)
    expect(names).not.toContain('flag_urgent')
    expect(names).toHaveLength(16)
  })

  it('English-only lines get NO bilingual directive', () => {
    const body = buildInboundAssistantBody(ORG, APP_URL, 'sec')
    expect((body.model.messages[0].content as string)).not.toContain('# Bilingual')
  })

  it('English-caller trades: keeps Savannah + English transcriber but gets the trades fragment', () => {
    const trades = { ...ORG, vertical: 'trades', caller_languages: ['en'] }
    const body = buildInboundAssistantBody(trades, APP_URL, 'sec')
    expect(body.voice).toEqual({ provider: 'vapi', voiceId: 'Savannah' })
    expect(body.transcriber).toMatchObject({ language: 'en' })
    expect((body.model.messages[0].content as string)).toContain('# Vertical: home & trade services')
  })

  it('unknown/malformed vertical + caller_languages fall back to med-spa / English', () => {
    const weird = { ...ORG, vertical: 'zzz', caller_languages: ['fr', ''] as string[] }
    const body = buildInboundAssistantBody(weird, APP_URL, 'sec')
    expect(body.voice).toEqual({ provider: 'vapi', voiceId: 'Savannah' })
    expect(body.transcriber).toMatchObject({ language: 'en' })
    expect((body.model.messages[0].content as string)).not.toMatch(/# Vertical:/)
  })
})
