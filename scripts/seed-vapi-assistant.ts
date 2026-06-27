/**
 * Phase 5 W1 — one-shot Vapi assistant setup.
 *
 * Usage:
 *
 *   npx tsx scripts/seed-vapi-assistant.ts <org-id>
 *
 * What it does:
 *   1. Reads the system prompt from src/voice/prompts/receptionist.md.
 *   2. Loads the tool schemas from src/voice/tools/schemas.ts.
 *   3. POSTs to https://api.vapi.ai/assistant with the prompt +
 *      tools wired to our /api/voice/tool/* endpoints.
 *   4. Writes the returned assistant id back to
 *      organizations.call_agent_assistant_id.
 *
 * Env required:
 *   VAPI_API_KEY              — your Vapi private API key
 *   VAPI_WEBHOOK_SECRET       — shared secret for tool callbacks
 *                               (set the same value in Vapi dashboard)
 *   NEXT_PUBLIC_SUPABASE_URL  — for the DB write-back
 *   SUPABASE_SERVICE_ROLE_KEY — service role, bypasses RLS
 *   NEXT_PUBLIC_APP_URL       — public app URL Vapi will call
 *
 * Re-running is idempotent for the SAME org: a second run creates
 * a fresh Vapi assistant and overwrites the org's id. Old assistants
 * stay in your Vapi account — clean them up via the Vapi dashboard
 * if you don't want stale agents around.
 *
 * Picking a voice: Vapi supports cartesia / 11labs / playht /
 * deepgram / openai / azure. The default below is a Cartesia
 * "Sonic" voice (warm female, neutral US accent). Override via the
 * VAPI_VOICE_PROVIDER + VAPI_VOICE_ID env vars if you want
 * something else — list at https://docs.vapi.ai/voice/providers.
 */

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { config as loadEnv } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { ALL_TOOLS } from '../src/voice/tools/schemas'

// Next.js loads .env.local automatically in the app; standalone
// tsx scripts don't. Pull it in here so an invocation from the
// repo root just works.
for (const path of ['.env.local', '.env']) {
  const full = resolve(process.cwd(), path)
  if (existsSync(full)) loadEnv({ path: full })
}

const VAPI_API_KEY        = process.env.VAPI_API_KEY
const VAPI_WEBHOOK_SECRET = process.env.VAPI_WEBHOOK_SECRET
const APP_URL             = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://tarhunna.net').replace(/\/$/, '')
const SUPABASE_URL        = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY        = process.env.SUPABASE_SERVICE_ROLE_KEY

// OpenAI's "alloy" — neutral, professional, always available with
// no extra credentials. Override with VAPI_VOICE_PROVIDER + _ID if
// you want Vapi-native ("Elliot", "Riley") or a real Cartesia voice
// UUID from your Cartesia account.
const VOICE_PROVIDER = process.env.VAPI_VOICE_PROVIDER ?? 'openai'
const VOICE_ID       = process.env.VAPI_VOICE_ID       ?? 'alloy'

// ─── Tool name → tool-endpoint path mapping ────────────────────
// The system prompt references `get_context`, `lookup_availability`,
// `create_hold`, `confirm_booking`. The routes are pluralized
// differently for URL terseness — keep this map in sync if you
// rename either side.
const ROUTE_BY_TOOL: Record<string, string> = {
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

async function main() {
  const orgId = process.argv[2]
  if (!orgId) {
    console.error('Usage: npx tsx scripts/seed-vapi-assistant.ts <org-id>')
    process.exit(1)
  }
  if (!VAPI_API_KEY) {
    console.error('VAPI_API_KEY is required (drop in .env.local or export inline)')
    process.exit(1)
  }
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required')
    process.exit(1)
  }
  if (!VAPI_WEBHOOK_SECRET) {
    console.warn('VAPI_WEBHOOK_SECRET is not set — Vapi will hit our tool routes with no shared secret and the routes will log a warning + accept. Lock this down before real patient traffic.')
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })

  // Pull the org so we can name the assistant after the clinic.
  const { data: org, error } = await supabase
    .from('organizations')
    .select('id, name, slug')
    .eq('id', orgId)
    .single()
  if (error || !org) {
    console.error(`Could not find organization ${orgId}:`, error?.message)
    process.exit(1)
  }

  const promptPath = resolve(process.cwd(), 'src/voice/prompts/receptionist.md')
  const systemPrompt = readFileSync(promptPath, 'utf8')

  // Wire each tool to its endpoint + shared secret.
  const tools = ALL_TOOLS.map(t => {
    const route = ROUTE_BY_TOOL[t.function.name]
    if (!route) throw new Error(`No route mapping for tool ${t.function.name}`)
    return {
      type:     'function',
      async:    false,
      function: t.function,
      server: {
        url:    `${APP_URL}/api/voice/tool/${route}`,
        secret: VAPI_WEBHOOK_SECRET ?? undefined,
      },
    }
  })

  const assistantBody = {
    name: `${org.name} receptionist`,
    model: {
      provider: 'openai',
      model:    'gpt-4o-mini',
      messages: [{ role: 'system', content: systemPrompt }],
      tools,
      temperature: 0.4,
    },
    voice:        { provider: VOICE_PROVIDER, voiceId: VOICE_ID },
    transcriber:  { provider: 'deepgram', model: 'nova-2', language: 'en' },
    // Twilio plays our disclosure + recording-consent opener via
    // TwiML BEFORE handing the audio to Vapi, so the first Vapi
    // utterance should be brief and contextual rather than another
    // greeting. The system prompt tells the model to call
    // get_context first; this firstMessage covers the silent
    // ~600ms while that tool roundtrips.
    firstMessage: 'One moment while I pull up the clinic\'s info...',
    serverUrl:        `${APP_URL}/api/webhooks/vapi/call-end`,
    serverUrlSecret:  VAPI_WEBHOOK_SECRET ?? undefined,
    metadata: {
      orgId:    org.id,
      orgSlug:  org.slug,
      seededAt: new Date().toISOString(),
    },
  }

  console.log(`[seed-vapi] Creating assistant for ${org.name} (${org.id})...`)
  const res = await fetch('https://api.vapi.ai/assistant', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${VAPI_API_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify(assistantBody),
  })

  if (!res.ok) {
    const text = await res.text()
    console.error(`[seed-vapi] Vapi rejected the assistant: ${res.status}\n${text}`)
    process.exit(1)
  }

  const created = await res.json() as { id?: string }
  if (!created.id) {
    console.error('[seed-vapi] Vapi response missing id:', created)
    process.exit(1)
  }

  console.log(`[seed-vapi] Created assistant ${created.id}`)

  const { error: updErr } = await supabase
    .from('organizations')
    .update({
      call_agent_assistant_id: created.id,
      call_agent_voice_id:     VOICE_ID,
    })
    .eq('id', org.id)

  if (updErr) {
    console.error('[seed-vapi] Created the assistant but could not save the id to the org:', updErr.message)
    console.error(`[seed-vapi] Manually run: update organizations set call_agent_assistant_id = '${created.id}' where id = '${org.id}';`)
    process.exit(1)
  }

  console.log('[seed-vapi] Saved call_agent_assistant_id on the org.')
  console.log('[seed-vapi] Done. Visit /settings/call-agent on the dashboard to finish setup.')
}

main().catch(err => {
  console.error('[seed-vapi] Unexpected error:', err)
  process.exit(1)
})
