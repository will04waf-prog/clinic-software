/**
 * Vapi assistant seeding — shared by the self-serve provisioning flow
 * and the operator CLI scripts.
 *
 * History: assistant creation lived only in scripts/seed-vapi-assistant.ts
 * and scripts/seed-vapi-reminder-assistant.ts, run by hand per org. That
 * made "Get Layla's phone number" a dead end for self-serve owners —
 * /api/admin/numbers/provision 409'd with assistant_not_seeded until the
 * operator intervened. This module is the single source of truth for the
 * assistant bodies; the scripts are now thin wrappers over it.
 *
 * Idempotency: ensure*Assistant() short-circuits when the org already
 * has an assistant id stored, so it's safe to call on every provisioning
 * attempt. Pass { forceNew: true } (the scripts do) to deliberately mint
 * a fresh assistant and overwrite the stored id — old assistants remain
 * in the Vapi account and can be cleaned up in their dashboard.
 *
 * Prompts are read from src/voice/prompts/*.md at call time. In the
 * Vercel lambda those files exist only because next.config.ts traces
 * them in via outputFileTracingIncludes — keep that entry in sync if
 * the prompt files move.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ALL_TOOLS } from '../../voice/tools/schemas'
import { getAppUrl } from './app-url'
import { getVerticalConfig, resolveCallerLanguages } from '@/lib/vertical/config'

// Vapi-native "Savannah" — warm professional female ('Paige' is in
// Vapi's LEGACY set and new assistants are rejected with it), and served from
// Vapi's own edge so time-to-first-sound is far lower than the old
// openai/alloy default (real-call feedback: replies dragged and
// Layla filled the gaps with "give me a sec"). Override with
// VAPI_VOICE_PROVIDER + _ID env vars.
const VOICE_PROVIDER = () => process.env.VAPI_VOICE_PROVIDER ?? 'vapi'
const VOICE_ID       = () => process.env.VAPI_VOICE_ID       ?? 'Savannah'

// ─── Tool name → tool-endpoint path mappings ─────────────────────
// The inbound receptionist ships every tool; the reminder bot ships a
// curated subset (no new bookings, no transfer — see the reminder
// prompt for rationale). The two maps are separate ON PURPOSE: their
// lifecycles must stay independently editable when routes are renamed.
const INBOUND_ROUTE_BY_TOOL: Record<string, string> = {
  get_context:             'context',
  find_service:            'find-service',
  lookup_availability:     'availability',
  lookup_my_appointments:  'my-appointments',
  reschedule_appointment:  'reschedule-appointment',
  cancel_appointment:      'cancel-appointment',
  create_hold:             'hold',
  confirm_booking:         'confirm',
  give_directions:         'give-directions',
  send_link_sms:           'send-link-sms',
  take_message:            'take-message',
  transfer_to_human:       'transfer-to-human',
  pre_visit_instructions:  'pre-visit-instructions',
  post_call_summary_email: 'post-call-summary-email',
  lookup_faq:              'lookup-faq',
  confirm_appointment:     'confirm-appointment',
  flag_urgent:             'flag-urgent',
}

const REMINDER_TOOL_NAMES: ReadonlySet<string> = new Set([
  'get_context',
  'lookup_availability',
  'confirm_appointment',
  'reschedule_appointment',
  'cancel_appointment',
  'take_message',
  'post_call_summary_email',
])

const REMINDER_ROUTE_BY_TOOL: Record<string, string> = {
  get_context:             'context',
  lookup_availability:     'availability',
  confirm_appointment:     'confirm-appointment',
  reschedule_appointment:  'reschedule-appointment',
  cancel_appointment:      'cancel-appointment',
  take_message:            'take-message',
  post_call_summary_email: 'post-call-summary-email',
}

interface OrgRow {
  id:   string
  name: string
  slug: string
  /** Multi-vertical Phase 1. Optional so callers that don't select
   *  them fall through to med-spa defaults via getVerticalConfig /
   *  resolveCallerLanguages. */
  vertical?:         string | null
  caller_languages?: string[] | null
}

// ─── Spanish TTS voice (bilingual tenants) ───────────────────────
// A tenant whose caller_languages include 'es' gets ONE voice that
// must sound natural in BOTH English and Spanish — customers often
// call in English while the owner is Spanish-speaking. LOCKED
// 2026-07-05 to Azure es-MX-DaliaNeural (audition voice "C" — warmest,
// most neutral Latin-American Spanish) after a real-call comparison
// against ElevenLabs multilingual and Azure es-US-Paloma. Env-
// overridable in one place here. English-only tenants keep Savannah,
// byte-identical.
const SPANISH_VOICE = () => {
  const provider = process.env.VAPI_ES_VOICE_PROVIDER ?? 'azure'
  const voiceId  = process.env.VAPI_ES_VOICE_ID       ?? 'es-MX-DaliaNeural'
  // The 11labs branch carries the model field; Azure/others don't.
  return provider === '11labs'
    ? { provider, voiceId, model: process.env.VAPI_ES_VOICE_MODEL ?? 'eleven_multilingual_v2' }
    : { provider, voiceId }
}

function selectVoice(langs: readonly string[]) {
  return langs.includes('es')
    ? SPANISH_VOICE()
    : { provider: VOICE_PROVIDER(), voiceId: VOICE_ID() }
}

function selectTranscriber(langs: readonly string[]) {
  // Deepgram nova-2 with language 'multi' handles EN/ES code-switching;
  // English-only stays 'en' (byte-identical to today). VERIFY the exact
  // multilingual model string against Vapi/Deepgram before a bilingual
  // tenant goes live.
  return langs.includes('es')
    ? { provider: 'deepgram', model: 'nova-2', language: 'multi' }
    : { provider: 'deepgram', model: 'nova-2', language: 'en' }
}

function readVerticalFragment(name: string): string {
  return readFileSync(resolve(process.cwd(), 'src/voice/prompts/verticals', `${name}.md`), 'utf8')
}

// Append the vertical's terminology-reframe fragment (med-spa appends
// nothing → identical to today) and the bilingual directive when the
// line serves Spanish callers. Shared by the inbound + reminder prompt
// composers so both reframe terminology identically. The 911 safety
// rail lives in each base prompt and every fragment preserves it.
function appendVerticalFragments(
  base: string,
  vertical: string | null | undefined,
  langs: readonly string[],
): string {
  const cfg = getVerticalConfig(vertical)
  let prompt = base
  if (cfg.promptFragment) {
    prompt += '\n\n' + readVerticalFragment(cfg.promptFragment)
  }
  if (langs.includes('es')) {
    prompt += '\n\n' + readFileSync(
      resolve(process.cwd(), 'src/voice/prompts', 'bilingual.md'), 'utf8',
    )
  }
  return prompt
}

// Base receptionist prompt + vertical fragment + bilingual directive.
function composeInboundPrompt(
  vertical: string | null | undefined,
  langs: readonly string[],
): string {
  return appendVerticalFragments(readPrompt('receptionist.md'), vertical, langs)
}

// Base outbound-reminder prompt + vertical fragment + bilingual
// directive. Med-spa / English → reminder.md alone, identical to today.
function composeReminderPrompt(
  vertical: string | null | undefined,
  langs: readonly string[],
): string {
  return appendVerticalFragments(readPrompt('reminder.md'), vertical, langs)
}

// Outbound opener. WE call THEM, so the first thing the contact hears IS
// the assistant — identify, state the engagement, ask in one breath.
// Wording follows the vertical's engagement noun + caller language;
// Spanish-capable lines open in Spanish. Med-spa / English reproduces
// the prior hardcoded line byte-for-byte (medspa engagement ===
// 'appointment').
function reminderFirstMessage(
  vertical: string | null | undefined,
  langs: readonly string[],
): string {
  const terms = getVerticalConfig(vertical).terms
  return langs.includes('es')
    ? `Hola, soy Layla y le llamo sobre su ${terms.engagementEs} — ¿tiene un momento?`
    : `Hi, this is Layla calling about your upcoming ${terms.engagement} — do you have a quick moment?`
}

// Tools wired only for specific verticals — excluded from the base
// inbound set, then re-added per config.extraTools. flag_urgent (trades)
// ships in Phase 4; naming it here means that once it's added to
// ALL_TOOLS + INBOUND_ROUTE_BY_TOOL it is automatically restricted to
// trades and never appears on med-spa assistants.
const VERTICAL_GATED_TOOLS: ReadonlySet<string> = new Set(['flag_urgent'])

function inboundToolFilter(vertical: string | null | undefined): ReadonlySet<string> {
  const cfg = getVerticalConfig(vertical)
  const names = new Set<string>()
  for (const t of ALL_TOOLS) {
    if (!VERTICAL_GATED_TOOLS.has(t.function.name)) names.add(t.function.name)
  }
  for (const name of cfg.extraTools) {
    // Only wire extras that already exist (schema + route). Skips
    // flag_urgent until Phase 4 lands it, so no assistant points at a
    // missing endpoint.
    if (ALL_TOOLS.some(t => t.function.name === name) && INBOUND_ROUTE_BY_TOOL[name]) {
      names.add(name)
    }
  }
  return names
}

export interface EnsureAssistantOptions {
  /** Any Supabase client with service-role access to organizations. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
  orgId: string
  /** Mint a fresh assistant even if one is already stored (CLI re-seed). */
  forceNew?: boolean
  /** Override the public app URL (scripts pass SEED_APP_URL). */
  appUrl?: string
}

export interface EnsureAssistantResult {
  assistantId: string
  /** false = an existing id was reused, no Vapi call made. */
  created: boolean
}

function requireEnv(): { apiKey: string; webhookSecret: string | undefined } {
  const apiKey = process.env.VAPI_API_KEY
  if (!apiKey) {
    throw new Error('VAPI_API_KEY is not configured — cannot create a Vapi assistant.')
  }
  const webhookSecret = process.env.VAPI_WEBHOOK_SECRET
  if (!webhookSecret) {
    console.warn('[seed-assistants] VAPI_WEBHOOK_SECRET is not set — tool routes will accept unsigned callbacks.')
  }
  return { apiKey, webhookSecret }
}

function resolveAppUrl(override?: string): string {
  const url = (override ?? getAppUrl()).replace(/\/$/, '')
  // A Vapi assistant seeded with a localhost URL receives no tool calls
  // (Vapi's cloud can't reach 127.0.0.1) AND no call-end webhook. The
  // symptom is a call that connects but where the bot has no working
  // tools. Refuse loudly rather than mint a broken assistant.
  if (/localhost|127\.0\.0\.1/.test(url)) {
    throw new Error(`Refusing to seed a Vapi assistant against ${url} — Vapi cloud cannot reach it. Set SEED_APP_URL / NEXT_PUBLIC_APP_URL to the public host.`)
  }
  return url
}

function readPrompt(file: 'receptionist.md' | 'reminder.md'): string {
  // cwd is the repo root in dev/scripts and /var/task in the Vercel
  // lambda; the traced files keep their repo-relative layout in both.
  return readFileSync(resolve(process.cwd(), 'src/voice/prompts', file), 'utf8')
}

function wireTools(
  routeByTool: Record<string, string>,
  filter: ReadonlySet<string> | null,
  appUrl: string,
  webhookSecret: string | undefined,
) {
  const tools = ALL_TOOLS
    .filter(t => filter === null || filter.has(t.function.name))
    .map(t => {
      const route = routeByTool[t.function.name]
      if (!route) throw new Error(`No route mapping for tool ${t.function.name}`)
      return {
        type:     'function' as const,
        async:    false,
        function: t.function,
        server: {
          url:    `${appUrl}/api/voice/tool/${route}`,
          secret: webhookSecret ?? undefined,
        },
      }
    })
  // If schemas.ts drops a tool the reminder bot depends on, fail loudly
  // rather than ship a partially-disabled bot.
  if (filter !== null) {
    for (const expected of filter) {
      if (!tools.find(t => t.function.name === expected)) {
        throw new Error(`Expected tool "${expected}" not present in ALL_TOOLS`)
      }
    }
  }
  return tools
}

export function buildInboundAssistantBody(org: OrgRow, appUrl: string, webhookSecret: string | undefined) {
  // Multi-vertical Phase 1: prompt, tools, transcriber, and voice all
  // derive from the org's vertical + caller_languages. Defaults
  // (medspa / {en}) reproduce the prior body exactly.
  const langs = resolveCallerLanguages(org.caller_languages)
  return {
    name: `${org.name} receptionist`,
    model: {
      provider: 'openai',
      model:    'gpt-4o-mini',
      messages: [{ role: 'system', content: composeInboundPrompt(org.vertical, langs) }],
      tools:    wireTools(INBOUND_ROUTE_BY_TOOL, inboundToolFilter(org.vertical), appUrl, webhookSecret),
      temperature: 0.4,
    },
    voice:       selectVoice(langs),
    transcriber: selectTranscriber(langs),
    // Vapi's default is a synthetic "office" ambience — real-call
    // feedback: it reads as noise, not realism. Silence is cleaner.
    backgroundSound: 'off',
    // Pipeline-provisioned numbers are answered by Vapi DIRECTLY (the
    // register step binds the number to the assistant and Vapi
    // rewrites the voice webhook) — there is no TwiML preamble. The
    // old "One moment while I pull up the clinic's info..." opener
    // assumed one, producing that line followed by dead air until the
    // caller spoke first. Open like a receptionist instead; the brief
    // recording line covers consent in the direct flow.
    firstMessage: `Thanks for calling ${org.name}, this is Layla! Just so you know, this call may be recorded. What can I do for you today?`,
    serverUrl:        `${appUrl}/api/webhooks/vapi/call-end`,
    serverUrlSecret:  webhookSecret ?? undefined,
    // end-of-call-report must be subscribed explicitly or call_logs
    // stays empty. (Vapi only sends tool-call events by default.)
    serverMessages: ['end-of-call-report', 'status-update', 'hang'],
    metadata: { orgId: org.id, orgSlug: org.slug, seededAt: new Date().toISOString() },
  }
}

export function buildReminderAssistantBody(org: OrgRow, appUrl: string, webhookSecret: string | undefined) {
  // Multi-vertical: prompt, voice, transcriber, and the outbound opener
  // all derive from the org's vertical + caller_languages, exactly as
  // buildInboundAssistantBody does. Defaults (medspa / {en}) reproduce
  // the prior body byte-for-byte. The tool set stays reminder-specific.
  const langs = resolveCallerLanguages(org.caller_languages)
  return {
    name: `${org.name} reminder bot`,
    model: {
      provider: 'openai',
      model:    'gpt-4o-mini',
      messages: [{ role: 'system', content: composeReminderPrompt(org.vertical, langs) }],
      tools:    wireTools(REMINDER_ROUTE_BY_TOOL, REMINDER_TOOL_NAMES, appUrl, webhookSecret),
      temperature: 0.4,
    },
    voice:       selectVoice(langs),
    transcriber: selectTranscriber(langs),
    backgroundSound: 'off',
    // Outbound: WE call THEM, so the first thing the contact hears IS
    // the assistant — identify and ask in one breath. See
    // reminderFirstMessage for the vertical/language wording.
    firstMessage: reminderFirstMessage(org.vertical, langs),
    serverUrl:        `${appUrl}/api/webhooks/vapi/call-end`,
    serverUrlSecret:  webhookSecret ?? undefined,
    serverMessages: ['end-of-call-report', 'status-update', 'hang'],
    metadata: { orgId: org.id, orgSlug: org.slug, role: 'reminder', seededAt: new Date().toISOString() },
  }
}

async function createVapiAssistant(apiKey: string, body: unknown): Promise<string> {
  let res: Response
  try {
    res = await fetch('https://api.vapi.ai/assistant', {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
      // A hung Vapi must not run the provision lambda to its function
      // timeout — fail fast with a retryable error instead.
      signal:  AbortSignal.timeout(30_000),
    })
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      throw new Error('Vapi assistant creation timed out after 30s — try again.')
    }
    throw err
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Vapi rejected the assistant: ${res.status} ${text.slice(0, 500)}`)
  }
  const created = await res.json() as { id?: string }
  if (!created.id) throw new Error('Vapi response missing assistant id')
  return created.id
}

async function patchVapiAssistant(apiKey: string, assistantId: string, body: unknown): Promise<void> {
  let res: Response
  try {
    res = await fetch(`https://api.vapi.ai/assistant/${assistantId}`, {
      method:  'PATCH',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
      signal:  AbortSignal.timeout(30_000),
    })
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      throw new Error('Vapi assistant update timed out after 30s — try again.')
    }
    throw err
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Vapi rejected the assistant update: ${res.status} ${text.slice(0, 500)}`)
  }
}

/**
 * Re-sync an org's EXISTING inbound assistant IN PLACE — used when the
 * owner changes a setting that alters the assistant body (today: caller
 * languages, which switch the voice, transcriber, and bilingual
 * directive). We PATCH the stored assistant rather than mint a new one,
 * so the Vapi phone-number binding is untouched — no rebind needed.
 *
 * NEVER THROWS. It's called from a settings PATCH that has already saved
 * the config to the DB, so a Vapi/config hiccup must not fail the save —
 * it returns { synced:false, reason } and the caller surfaces a soft
 * "voice sync" status. Only the config-derived fields are patched
 * (model, voice, transcriber); name/serverUrl/metadata are left as-is.
 */
export async function syncInboundAssistant(
  opts: EnsureAssistantOptions,
): Promise<{ synced: boolean; reason?: string }> {
  let assistantId: string
  let apiKey: string
  let body: ReturnType<typeof buildInboundAssistantBody>
  try {
    const org = await fetchOrg(opts.supabase, opts.orgId, 'call_agent_assistant_id')
    if (!org.call_agent_assistant_id) return { synced: false, reason: 'not_seeded' }
    assistantId = org.call_agent_assistant_id
    const env = requireEnv()
    apiKey = env.apiKey
    const appUrl = resolveAppUrl(opts.appUrl)
    body = buildInboundAssistantBody(org, appUrl, env.webhookSecret)
  } catch (err) {
    // Config-time failure (missing key, localhost URL, org not found).
    return { synced: false, reason: err instanceof Error ? err.message : 'config_error' }
  }
  try {
    await patchVapiAssistant(apiKey, assistantId, {
      model:       body.model,
      voice:       body.voice,
      transcriber: body.transcriber,
    })
    return { synced: true }
  } catch (err) {
    console.error('[syncInboundAssistant] vapi patch failed:', err instanceof Error ? err.message : err)
    return { synced: false, reason: 'vapi_error' }
  }
}

async function fetchOrg(supabase: EnsureAssistantOptions['supabase'], orgId: string, extraCol: string) {
  const { data: org, error } = await supabase
    .from('organizations')
    .select(`id, name, slug, vertical, caller_languages, ${extraCol}`)
    .eq('id', orgId)
    .single()
  if (error || !org) throw new Error(`Could not load organization ${orgId}: ${error?.message ?? 'not found'}`)
  return org
}

/**
 * Inbound receptionist assistant. Stamps call_agent_assistant_id (+
 * call_agent_voice_id) on the org. No-op when already seeded unless
 * forceNew.
 */
export async function ensureInboundAssistant(opts: EnsureAssistantOptions): Promise<EnsureAssistantResult> {
  const org = await fetchOrg(opts.supabase, opts.orgId, 'call_agent_assistant_id')
  if (org.call_agent_assistant_id && !opts.forceNew) {
    return { assistantId: org.call_agent_assistant_id, created: false }
  }

  const { apiKey, webhookSecret } = requireEnv()
  const appUrl = resolveAppUrl(opts.appUrl)
  const assistantId = await createVapiAssistant(apiKey, buildInboundAssistantBody(org, appUrl, webhookSecret))

  // Conditional stamp (unless forceNew): two concurrent provision
  // requests can both pass the null check and both mint an assistant
  // — the .is() filter makes the first writer win deterministically
  // instead of last-write-wins silently orphaning the winner.
  let query = opts.supabase
    .from('organizations')
    .update({ call_agent_assistant_id: assistantId, call_agent_voice_id: VOICE_ID() })
    .eq('id', org.id)
  if (!opts.forceNew) query = query.is('call_agent_assistant_id', null)
  const { data: stamped, error: updErr } = await query.select('call_agent_assistant_id')
  if (updErr) {
    throw new Error(`Created Vapi assistant ${assistantId} but could not save it to org ${org.id}: ${updErr.message}. Manually run: update organizations set call_agent_assistant_id = '${assistantId}' where id = '${org.id}';`)
  }
  if (!opts.forceNew && (!stamped || stamped.length === 0)) {
    // Lost the race — someone else stamped first. Our assistant is
    // orphaned in Vapi (log its id for dashboard cleanup); return the
    // winner so callers proceed with the id actually on the org.
    console.warn(`[seed-assistants] lost seeding race for org ${org.id}; orphaned Vapi assistant ${assistantId} — clean up in the Vapi dashboard`)
    const winner = await fetchOrg(opts.supabase, opts.orgId, 'call_agent_assistant_id')
    return { assistantId: winner.call_agent_assistant_id, created: false }
  }
  return { assistantId, created: true }
}

/**
 * Outbound reminder assistant. Stamps call_agent_reminder_assistant_id.
 * No-op when already seeded unless forceNew.
 */
export async function ensureReminderAssistant(opts: EnsureAssistantOptions): Promise<EnsureAssistantResult> {
  const org = await fetchOrg(opts.supabase, opts.orgId, 'call_agent_reminder_assistant_id')
  if (org.call_agent_reminder_assistant_id && !opts.forceNew) {
    return { assistantId: org.call_agent_reminder_assistant_id, created: false }
  }

  const { apiKey, webhookSecret } = requireEnv()
  const appUrl = resolveAppUrl(opts.appUrl)
  const assistantId = await createVapiAssistant(apiKey, buildReminderAssistantBody(org, appUrl, webhookSecret))

  // Same race-safe conditional stamp as the inbound path.
  let query = opts.supabase
    .from('organizations')
    .update({ call_agent_reminder_assistant_id: assistantId })
    .eq('id', org.id)
  if (!opts.forceNew) query = query.is('call_agent_reminder_assistant_id', null)
  const { data: stamped, error: updErr } = await query.select('call_agent_reminder_assistant_id')
  if (updErr) {
    throw new Error(`Created Vapi reminder assistant ${assistantId} but could not save it to org ${org.id}: ${updErr.message}. Manually run: update organizations set call_agent_reminder_assistant_id = '${assistantId}' where id = '${org.id}';`)
  }
  if (!opts.forceNew && (!stamped || stamped.length === 0)) {
    console.warn(`[seed-assistants] lost reminder-seeding race for org ${org.id}; orphaned Vapi assistant ${assistantId} — clean up in the Vapi dashboard`)
    const winner = await fetchOrg(opts.supabase, opts.orgId, 'call_agent_reminder_assistant_id')
    return { assistantId: winner.call_agent_reminder_assistant_id, created: false }
  }
  return { assistantId, created: true }
}
