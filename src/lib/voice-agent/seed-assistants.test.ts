import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  ensureInboundAssistant,
  ensureReminderAssistant,
  syncInboundAssistant,
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

describe('syncInboundAssistant (language settings live-sync)', () => {
  function stubVapiPatch(status = 200) {
    const calls: { url: string; method: string; body: any }[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), method: String(init?.method), body: JSON.parse(String(init?.body ?? '{}')) })
      return new Response(status < 300 ? JSON.stringify({ id: 'asst_1' }) : 'nope', { status })
    }))
    return calls
  }

  it('PATCHes the existing assistant in place with model+voice+transcriber only', async () => {
    const calls = stubVapiPatch()
    const supabase = fakeSupabase([{ ...ORG, caller_languages: ['en', 'es'], call_agent_assistant_id: 'asst_1' }])
    const res = await syncInboundAssistant({ supabase, orgId: ORG.id, appUrl: APP_URL })
    expect(res).toEqual({ synced: true })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://api.vapi.ai/assistant/asst_1')
    expect(calls[0].method).toBe('PATCH')
    // Subset PATCH — must not touch id-adjacent or webhook fields.
    expect(Object.keys(calls[0].body).sort()).toEqual(['model', 'transcriber', 'voice'])
    // Bilingual set drives the multilingual transcriber + ES voice.
    expect(calls[0].body.transcriber).toMatchObject({ language: 'multi' })
    expect(calls[0].body.voice.provider).not.toBe('vapi')
    expect(calls[0].body.model.messages[0].content).toContain('# Bilingual — English & Spanish')
  })

  it('reverting to English-only restores the default voice + transcriber', async () => {
    const calls = stubVapiPatch()
    const supabase = fakeSupabase([{ ...ORG, caller_languages: ['en'], call_agent_assistant_id: 'asst_1' }])
    const res = await syncInboundAssistant({ supabase, orgId: ORG.id, appUrl: APP_URL })
    expect(res.synced).toBe(true)
    expect(calls[0].body.voice).toEqual({ provider: 'vapi', voiceId: 'Savannah' })
    expect(calls[0].body.transcriber).toMatchObject({ language: 'en' })
    expect(calls[0].body.model.messages[0].content).not.toContain('# Bilingual')
  })

  it('no assistant yet → synced:false reason not_seeded, no Vapi call', async () => {
    const calls = stubVapiPatch()
    const supabase = fakeSupabase([{ ...ORG, call_agent_assistant_id: null }])
    const res = await syncInboundAssistant({ supabase, orgId: ORG.id, appUrl: APP_URL })
    expect(res).toEqual({ synced: false, reason: 'not_seeded' })
    expect(calls).toHaveLength(0)
  })

  it('Vapi rejection → synced:false vapi_error (never throws)', async () => {
    stubVapiPatch(500)
    const supabase = fakeSupabase([{ ...ORG, caller_languages: ['es'], call_agent_assistant_id: 'asst_1' }])
    const res = await syncInboundAssistant({ supabase, orgId: ORG.id, appUrl: APP_URL })
    expect(res).toEqual({ synced: false, reason: 'vapi_error' })
  })

  it('config errors (missing key, localhost URL) are swallowed into synced:false', async () => {
    delete process.env.VAPI_API_KEY
    const supabase = fakeSupabase([{ ...ORG, call_agent_assistant_id: 'asst_1' }])
    const res = await syncInboundAssistant({ supabase, orgId: ORG.id, appUrl: APP_URL })
    expect(res.synced).toBe(false)
    expect(res.reason).toMatch(/VAPI_API_KEY/)

    process.env.VAPI_API_KEY = 'test-key'
    const res2 = await syncInboundAssistant({
      supabase: fakeSupabase([{ ...ORG, call_agent_assistant_id: 'asst_1' }]),
      orgId: ORG.id,
      appUrl: 'http://localhost:3000',
    })
    expect(res2.synced).toBe(false)
    expect(res2.reason).toMatch(/localhost/)
  })
})

describe('multi-vertical config (Phase 1)', () => {
  // ORG has no vertical / caller_languages → exercises the defaults
  // path (medspa / {en}), which must reproduce the prior body exactly.
  it('med-spa defaults are byte-identical to the pre-multi-vertical body', () => {
    // Explicit medspa (real med-spa orgs always carry it; DEFAULT_VERTICAL
    // is now landscaping). This still guards the byte-identical med-spa body.
    const body = buildInboundAssistantBody({ ...ORG, vertical: 'medspa' }, APP_URL, 'sec')
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

  it('unknown/malformed vertical falls back to the default (landscaping); bad caller_languages → English', () => {
    const weird = { ...ORG, vertical: 'zzz', caller_languages: ['fr', ''] as string[] }
    const landscaping = { ...ORG, vertical: 'landscaping', caller_languages: ['fr', ''] as string[] }
    const w = buildInboundAssistantBody(weird, APP_URL, 'sec')
    const l = buildInboundAssistantBody(landscaping, APP_URL, 'sec')
    // Unknown vertical resolves to DEFAULT_VERTICAL (landscaping): the
    // vertical-derived parts must match. (Compare those, not the whole
    // body — metadata.seededAt is a per-call timestamp.)
    expect(w.voice).toEqual(l.voice)
    expect(w.transcriber).toEqual(l.transcriber)
    expect((w.model.messages[0].content as string)).toEqual(l.model.messages[0].content as string)
    // bad caller_languages (['fr','']) → English transcriber
    expect(w.transcriber).toMatchObject({ language: 'en' })
  })
})

describe('reminder bot multi-vertical (Phase 1)', () => {
  // ORG has no vertical / caller_languages → defaults path (medspa /
  // {en}), which must reproduce the prior reminder body exactly.
  it('med-spa defaults are byte-identical to the pre-multi-vertical reminder body', () => {
    const body = buildReminderAssistantBody({ ...ORG, vertical: 'medspa' }, APP_URL, 'sec')
    expect(body.voice).toEqual({ provider: 'vapi', voiceId: 'Savannah' })
    expect(body.transcriber).toEqual({ provider: 'deepgram', model: 'nova-2', language: 'en' })
    expect(body.model.tools).toHaveLength(7)
    const sys = (body.model.messages[0].content as string)
    expect(sys).toContain('# Layla-Reminder — Tarhunna outbound appointment reminder') // base prompt
    expect(sys).not.toMatch(/# Vertical:/)      // no fragment appended
    expect(sys).not.toContain('# Bilingual')    // no bilingual directive
    expect(body.firstMessage).toBe(
      'Hi, this is Layla calling about your upcoming appointment — do you have a quick moment?',
    )
  })

  it('bilingual trades reminder: Spanish voice, multilingual transcriber, trades fragment + bilingual, Spanish opener', () => {
    const trades = { ...ORG, vertical: 'trades', caller_languages: ['en', 'es'] }
    const body = buildReminderAssistantBody(trades, APP_URL, 'sec')
    expect(body.transcriber).toMatchObject({ language: 'multi' })
    expect((body.voice as { provider: string }).provider).not.toBe('vapi') // not Savannah
    const sys = (body.model.messages[0].content as string)
    expect(sys).toContain('# Vertical: home & trade services')
    expect(sys).toContain('# Bilingual — English & Spanish')
    // Opener uses the vertical's Spanish engagement noun ('trabajo').
    expect(body.firstMessage).toBe(
      'Hola, soy Layla y le llamo sobre su trabajo — ¿tiene un momento?',
    )
    // Tool subset stays reminder-specific regardless of vertical.
    expect(body.model.tools).toHaveLength(7)
  })

  it('English-caller trades reminder: Savannah + English transcriber, trades fragment, English "job" opener', () => {
    const trades = { ...ORG, vertical: 'trades', caller_languages: ['en'] }
    const body = buildReminderAssistantBody(trades, APP_URL, 'sec')
    expect(body.voice).toEqual({ provider: 'vapi', voiceId: 'Savannah' })
    expect(body.transcriber).toMatchObject({ language: 'en' })
    const sys = (body.model.messages[0].content as string)
    expect(sys).toContain('# Vertical: home & trade services')
    expect(sys).not.toContain('# Bilingual')
    expect(body.firstMessage).toBe(
      'Hi, this is Layla calling about your upcoming job — do you have a quick moment?',
    )
  })
})
