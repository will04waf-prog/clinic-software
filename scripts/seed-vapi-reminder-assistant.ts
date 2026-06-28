/**
 * Phase 5 W2 — one-shot Vapi setup for the OUTBOUND reminder bot.
 *
 * Usage:
 *
 *   npx tsx scripts/seed-vapi-reminder-assistant.ts <org-id>
 *
 * What it does:
 *   1. Reads the reminder system prompt from
 *      src/voice/prompts/reminder.md.
 *   2. Builds a smaller tool subset than the inbound receptionist —
 *      see TOOL_NAMES_FOR_REMINDER below for the rationale.
 *   3. POSTs to https://api.vapi.ai/assistant with the reminder
 *      prompt + the curated tool list.
 *   4. Writes the returned assistant id back to
 *      organizations.call_agent_reminder_assistant_id.
 *
 * Why a separate assistant (not reuse the inbound one):
 *   - Different system prompt: the reminder bot opens with "Hi
 *     this is Layla calling about your appointment" rather than
 *     "Thanks for calling Tarhunna". Reusing the inbound prompt
 *     would mean the outbound bot greets the patient like they
 *     dialed in.
 *   - Different tool subset: outbound is single-purpose (confirm
 *     OR live reschedule OR live cancel OR take-message). New
 *     booking, send-link-SMS mid-call, transfer-to-human, fuzzy
 *     service match — none of those make sense when WE called
 *     THEM about a SPECIFIC appointment.
 *   - Different cost / temperature profile possible (kept the same
 *     today for simplicity).
 *
 * Env required: same as seed-vapi-assistant.ts (VAPI_API_KEY,
 * VAPI_WEBHOOK_SECRET, NEXT_PUBLIC_SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_APP_URL).
 *
 * Re-running is idempotent for the SAME org: creates a fresh
 * Vapi assistant and overwrites the stored id. Old assistants
 * remain in Vapi (clean up via the dashboard).
 */

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { config as loadEnv } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { ALL_TOOLS } from '../src/voice/tools/schemas'

for (const path of ['.env.local', '.env']) {
  const full = resolve(process.cwd(), path)
  if (existsSync(full)) loadEnv({ path: full })
}

const VAPI_API_KEY        = process.env.VAPI_API_KEY
const VAPI_WEBHOOK_SECRET = process.env.VAPI_WEBHOOK_SECRET
// Reject localhost URLs hard — a Vapi assistant seeded with localhost
// receives no tool calls (Vapi's cloud can't reach 127.0.0.1) AND no
// call-end webhook. Symptom is a call that connects but where the
// bot has no working tools and we never learn how it ended. Bit me
// once in W1 + once in W2. The env var defaults to the public app
// URL; explicit localhost is a misconfiguration.
const RAW_APP_URL = (process.env.SEED_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'https://tarhunna.net')
if (/localhost|127\.0\.0\.1/.test(RAW_APP_URL)) {
  console.error(`[seed-vapi] refusing to seed against ${RAW_APP_URL} — Vapi cloud cannot reach it.\nSet SEED_APP_URL=https://your-prod-host (or unset NEXT_PUBLIC_APP_URL) and rerun.`)
  process.exit(1)
}
const APP_URL = RAW_APP_URL.replace(/\/$/, '')
const SUPABASE_URL        = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY        = process.env.SUPABASE_SERVICE_ROLE_KEY

const VOICE_PROVIDER = process.env.VAPI_VOICE_PROVIDER ?? 'openai'
const VOICE_ID       = process.env.VAPI_VOICE_ID       ?? 'alloy'

// ─── Curated tool subset for the reminder bot ────────────────────
// The receptionist has 16 tools (booking + cancel + reschedule +
// FAQ + give-directions + send-link-SMS + transfer + take-message
// + ...). The reminder bot can ONLY:
//   - get_context              (load clinic name; needed by the prompt)
//   - confirm_appointment      (the happy-path verb)
//   - reschedule_appointment   (patient wants to move it live)
//   - lookup_availability      (needed before reschedule)
//   - cancel_appointment       (patient wants to cancel live)
//   - take_message             (for "call back later" / confusion)
//   - post_call_summary_email  (every call ends with this)
//
// Notably EXCLUDED: find_service (no new bookings), create_hold +
// confirm_booking (no new bookings), give_directions /
// send_link_sms (out-of-scope for an outbound reminder),
// transfer_to_human (the clinic isn't necessarily staffed when
// the cron fires), lookup_faq (out-of-scope), lookup_my_appointments
// (we ALREADY have the consultation_id from the call metadata,
// asking for it again would be slow + redundant), pre_visit_instructions
// (read by Layla after booking; not the reminder bot's job).
// ─────────────────────────────────────────────────────────────────
const TOOL_NAMES_FOR_REMINDER: ReadonlySet<string> = new Set([
  'get_context',
  'lookup_availability',
  'confirm_appointment',
  'reschedule_appointment',
  'cancel_appointment',
  'take_message',
  'post_call_summary_email',
])

// Must match the ROUTE_BY_TOOL in scripts/seed-vapi-assistant.ts.
// Duplicated here on purpose: the inbound seeder's map can include
// route entries that the reminder bot doesn't ship, and they
// MUST stay in sync independently when entries are renamed. A
// shared module would couple their lifecycles.
const ROUTE_BY_TOOL: Record<string, string> = {
  get_context:             'context',
  lookup_availability:     'availability',
  confirm_appointment:     'confirm-appointment',
  reschedule_appointment:  'reschedule-appointment',
  cancel_appointment:      'cancel-appointment',
  take_message:            'take-message',
  post_call_summary_email: 'post-call-summary-email',
}

async function main() {
  const orgId = process.argv[2]
  if (!orgId) {
    console.error('Usage: npx tsx scripts/seed-vapi-reminder-assistant.ts <org-id>')
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

  const { data: org, error } = await supabase
    .from('organizations')
    .select('id, name, slug')
    .eq('id', orgId)
    .single()
  if (error || !org) {
    console.error(`Could not find organization ${orgId}:`, error?.message)
    process.exit(1)
  }

  const promptPath = resolve(process.cwd(), 'src/voice/prompts/reminder.md')
  const systemPrompt = readFileSync(promptPath, 'utf8')

  // Filter ALL_TOOLS by the curated set + wire to routes.
  const tools = ALL_TOOLS
    .filter(t => TOOL_NAMES_FOR_REMINDER.has(t.function.name))
    .map(t => {
      const route = ROUTE_BY_TOOL[t.function.name]
      if (!route) throw new Error(`No reminder-bot route mapping for tool ${t.function.name}`)
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

  // Sanity check: every tool we intended to include actually wired.
  // If the source schemas.ts removes a tool we depend on, fail
  // loudly here rather than ship a partially-disabled bot.
  for (const expected of TOOL_NAMES_FOR_REMINDER) {
    if (!tools.find(t => t.function.name === expected)) {
      console.error(`[seed-vapi-reminder] Expected tool "${expected}" not present in ALL_TOOLS — aborting.`)
      process.exit(1)
    }
  }

  const assistantBody = {
    name: `${org.name} reminder bot`,
    model: {
      provider: 'openai',
      model:    'gpt-4o-mini',
      messages: [{ role: 'system', content: systemPrompt }],
      tools,
      temperature: 0.4,
    },
    voice:        { provider: VOICE_PROVIDER, voiceId: VOICE_ID },
    transcriber:  { provider: 'deepgram', model: 'nova-2', language: 'en' },
    // Outbound calls don't have the Twilio TwiML disclosure preamble
    // that inbound runs through — we are the calling party, so the
    // first thing the patient hears IS the assistant. Keep it short,
    // identifying, and ask the yes/no question in one breath.
    firstMessage: 'Hi, this is Layla calling about your upcoming appointment — do you have a quick moment?',
    serverUrl:        `${APP_URL}/api/webhooks/vapi/call-end`,
    serverUrlSecret:  VAPI_WEBHOOK_SECRET ?? undefined,
    // Subscribe to end-of-call-report explicitly. Without this,
    // Vapi sends tool-call events but NOT the wrap-up that flips
    // consultations.voice_reminder_status from 'sent' to its
    // terminal disposition. Burned us twice in W2.
    serverMessages: ['end-of-call-report', 'status-update', 'hang'],
    metadata: {
      orgId:    org.id,
      orgSlug:  org.slug,
      role:     'reminder',
      seededAt: new Date().toISOString(),
    },
  }

  console.log(`[seed-vapi-reminder] Creating reminder assistant for ${org.name} (${org.id})...`)
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
    console.error(`[seed-vapi-reminder] Vapi rejected the assistant: ${res.status}\n${text}`)
    process.exit(1)
  }

  const created = await res.json() as { id?: string }
  if (!created.id) {
    console.error('[seed-vapi-reminder] Vapi response missing id:', created)
    process.exit(1)
  }

  console.log(`[seed-vapi-reminder] Created reminder assistant ${created.id}`)

  const { error: updErr } = await supabase
    .from('organizations')
    .update({ call_agent_reminder_assistant_id: created.id })
    .eq('id', org.id)

  if (updErr) {
    console.error('[seed-vapi-reminder] Created the assistant but could not save the id to the org:', updErr.message)
    console.error(`[seed-vapi-reminder] Manually run: update organizations set call_agent_reminder_assistant_id = '${created.id}' where id = '${org.id}';`)
    process.exit(1)
  }

  console.log('[seed-vapi-reminder] Saved call_agent_reminder_assistant_id on the org.')
  console.log('[seed-vapi-reminder] Done. Toggle "Send AI reminder calls" on /settings/call-agent to enable the cron.')
}

main().catch(err => {
  console.error('[seed-vapi-reminder] Unexpected error:', err)
  process.exit(1)
})
