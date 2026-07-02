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

// OpenAI's "alloy" — neutral, professional, always available with no
// extra credentials. Override with VAPI_VOICE_PROVIDER + _ID env vars.
const VOICE_PROVIDER = () => process.env.VAPI_VOICE_PROVIDER ?? 'openai'
const VOICE_ID       = () => process.env.VAPI_VOICE_ID       ?? 'alloy'

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
  return {
    name: `${org.name} receptionist`,
    model: {
      provider: 'openai',
      model:    'gpt-4o-mini',
      messages: [{ role: 'system', content: readPrompt('receptionist.md') }],
      tools:    wireTools(INBOUND_ROUTE_BY_TOOL, null, appUrl, webhookSecret),
      temperature: 0.4,
    },
    voice:       { provider: VOICE_PROVIDER(), voiceId: VOICE_ID() },
    transcriber: { provider: 'deepgram', model: 'nova-2', language: 'en' },
    // Twilio plays the disclosure/consent opener via TwiML BEFORE
    // handing audio to Vapi, so the first Vapi utterance is a brief
    // bridge over the get_context roundtrip, not another greeting.
    firstMessage: 'One moment while I pull up the clinic\'s info...',
    serverUrl:        `${appUrl}/api/webhooks/vapi/call-end`,
    serverUrlSecret:  webhookSecret ?? undefined,
    // end-of-call-report must be subscribed explicitly or call_logs
    // stays empty. (Vapi only sends tool-call events by default.)
    serverMessages: ['end-of-call-report', 'status-update', 'hang'],
    metadata: { orgId: org.id, orgSlug: org.slug, seededAt: new Date().toISOString() },
  }
}

export function buildReminderAssistantBody(org: OrgRow, appUrl: string, webhookSecret: string | undefined) {
  return {
    name: `${org.name} reminder bot`,
    model: {
      provider: 'openai',
      model:    'gpt-4o-mini',
      messages: [{ role: 'system', content: readPrompt('reminder.md') }],
      tools:    wireTools(REMINDER_ROUTE_BY_TOOL, REMINDER_TOOL_NAMES, appUrl, webhookSecret),
      temperature: 0.4,
    },
    voice:       { provider: VOICE_PROVIDER(), voiceId: VOICE_ID() },
    transcriber: { provider: 'deepgram', model: 'nova-2', language: 'en' },
    // Outbound: WE call THEM, so the first thing the patient hears IS
    // the assistant — identify and ask in one breath.
    firstMessage: 'Hi, this is Layla calling about your upcoming appointment — do you have a quick moment?',
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

async function fetchOrg(supabase: EnsureAssistantOptions['supabase'], orgId: string, extraCol: string) {
  const { data: org, error } = await supabase
    .from('organizations')
    .select(`id, name, slug, ${extraCol}`)
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
