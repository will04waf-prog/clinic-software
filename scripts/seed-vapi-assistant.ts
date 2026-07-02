/**
 * Phase 5 W1 — one-shot Vapi assistant setup (operator CLI).
 *
 * Usage:
 *
 *   npx tsx scripts/seed-vapi-assistant.ts <org-id>
 *
 * The assistant body + Vapi call + DB stamp all live in
 * src/lib/voice-agent/seed-assistants.ts — the SAME code the
 * self-serve provisioning route runs, so CLI and product can't
 * drift. This wrapper only handles env loading and arg parsing.
 *
 * Env required:
 *   VAPI_API_KEY              — your Vapi private API key
 *   VAPI_WEBHOOK_SECRET       — shared secret for tool callbacks
 *   NEXT_PUBLIC_SUPABASE_URL  — for the DB write-back
 *   SUPABASE_SERVICE_ROLE_KEY — service role, bypasses RLS
 *   NEXT_PUBLIC_APP_URL       — public app URL Vapi will call
 *                               (override with SEED_APP_URL)
 *
 * Re-running always creates a FRESH Vapi assistant and overwrites
 * the org's stored id (forceNew) — old assistants stay in your Vapi
 * account; clean them up via the Vapi dashboard.
 */

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { config as loadEnv } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

// Next.js loads .env.local automatically in the app; standalone tsx
// scripts don't. Must happen before the lib call (NOT before imports
// — ESM hoists those — which is why the supabase client is built
// here rather than imported from @/lib/supabase/admin).
for (const path of ['.env.local', '.env']) {
  const full = resolve(process.cwd(), path)
  if (existsSync(full)) loadEnv({ path: full })
}

async function main() {
  const orgId = process.argv[2]
  if (!orgId) {
    console.error('Usage: npx tsx scripts/seed-vapi-assistant.ts <org-id>')
    process.exit(1)
  }
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required')
    process.exit(1)
  }

  // Deferred import so dotenv above runs before any transitive module
  // reads env at load time.
  const { ensureInboundAssistant } = await import('../src/lib/voice-agent/seed-assistants')

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
  const appUrl = process.env.SEED_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'https://tarhunna.net'

  console.log(`[seed-vapi] Creating inbound assistant for org ${orgId}...`)
  const { assistantId } = await ensureInboundAssistant({ supabase, orgId, appUrl, forceNew: true })
  console.log(`[seed-vapi] Created assistant ${assistantId} and saved call_agent_assistant_id.`)
  console.log('[seed-vapi] Done. Visit /settings/call-agent on the dashboard to finish setup.')
}

main().catch(err => {
  console.error('[seed-vapi] Failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
