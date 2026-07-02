/**
 * Phase 5 W2 — one-shot Vapi setup for the OUTBOUND reminder bot
 * (operator CLI).
 *
 * Usage:
 *
 *   npx tsx scripts/seed-vapi-reminder-assistant.ts <org-id>
 *
 * The assistant body (curated tool subset — no new bookings, no
 * transfer; see the lib for rationale), the Vapi call, and the DB
 * stamp all live in src/lib/voice-agent/seed-assistants.ts — the
 * SAME code the self-serve provisioning route runs. This wrapper
 * only handles env loading and arg parsing.
 *
 * Env required: same as seed-vapi-assistant.ts.
 *
 * Re-running always creates a FRESH assistant and overwrites
 * call_agent_reminder_assistant_id (forceNew).
 */

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { config as loadEnv } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

for (const path of ['.env.local', '.env']) {
  const full = resolve(process.cwd(), path)
  if (existsSync(full)) loadEnv({ path: full })
}

async function main() {
  const orgId = process.argv[2]
  if (!orgId) {
    console.error('Usage: npx tsx scripts/seed-vapi-reminder-assistant.ts <org-id>')
    process.exit(1)
  }
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required')
    process.exit(1)
  }

  const { ensureReminderAssistant } = await import('../src/lib/voice-agent/seed-assistants')

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
  const appUrl = process.env.SEED_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'https://tarhunna.net'

  console.log(`[seed-vapi-reminder] Creating reminder assistant for org ${orgId}...`)
  const { assistantId } = await ensureReminderAssistant({ supabase, orgId, appUrl, forceNew: true })
  console.log(`[seed-vapi-reminder] Created assistant ${assistantId} and saved call_agent_reminder_assistant_id.`)
}

main().catch(err => {
  console.error('[seed-vapi-reminder] Failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
