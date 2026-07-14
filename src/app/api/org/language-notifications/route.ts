/**
 * Multi-vertical Phase 6 — GET/PATCH /api/org/language-notifications.
 *
 * Owner-facing surface for the four language/notification columns that
 * previously existed only in the DB (set by operator SQL):
 *
 *   - caller_languages    text[]  {en}|{es}|{en,es} — what the CALLER
 *     line handles. Drives the Vapi assistant's transcriber, TTS voice,
 *     and the bilingual prompt directive (seed-assistants.ts).
 *   - owner_language      'en'|'es' — language of OWNER-facing
 *     summaries/alerts ONLY (notify templates). Independent of the
 *     caller line: an English-speaking owner with a Spanish-speaking
 *     customer base is a core segment.
 *   - notification_channel 'sms'|'whatsapp'|'both' — owner alert push
 *     channel (notify/index.ts; WhatsApp hard-gated by WHATSAPP_ENABLED
 *     with SMS fallback, so 'whatsapp' is always safe to select).
 *   - owner_notify_e164   owner mobile for those alerts; null = email
 *     only.
 *
 * Owner-only (owner_notify_e164 is the owner's personal mobile; the
 * caller-language switch mutates the live Vapi assistant). NOT
 * tier-gated: owner alerts run on every plan, and caller_languages is
 * consumed at assistant-seed time regardless of when the org upgrades.
 *
 * Live-sync: when caller_languages changes and the org already has an
 * inbound assistant, we PATCH the Vapi assistant in place (voice +
 * transcriber + prompt) so the setting takes effect on the next call —
 * without it, the toggle would silently do nothing for a seeded org.
 * The sync is best-effort: the DB save always lands; the response
 * carries assistant_synced so the UI can surface a warning when Vapi
 * was unreachable.
 */

import { NextRequest, NextResponse } from 'next/server'
import type { TablesUpdate } from '@/types/database'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requireRole, isDenied, OWNER_ONLY } from '@/lib/auth/roles'
import { syncInboundAssistant } from '@/lib/voice-agent/seed-assistants'
import { z } from 'zod'

const E164_RE = /^\+[1-9]\d{6,14}$/

const patchSchema = z.object({
  // Non-empty, unique, subset of {en,es}. Order is not meaningful.
  caller_languages: z.array(z.enum(['en', 'es']))
    .min(1, 'At least one caller language is required.')
    .max(2)
    .refine((a) => new Set(a).size === a.length, 'Duplicate language.')
    .optional(),
  owner_language:       z.enum(['en', 'es']).optional(),
  notification_channel: z.enum(['sms', 'whatsapp', 'both']).optional(),
  owner_notify_e164:    z.string().regex(E164_RE, 'Owner mobile must be E.164, e.g. +13015551234.').nullable().optional(),
}).strict()

export async function GET() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await requireRole(supabase, user.id, OWNER_ONLY)
  if (isDenied(gate)) return gate.response

  const { data: org } = await supabase
    .from('organizations')
    .select('caller_languages, owner_language, notification_channel, owner_notify_e164, call_agent_assistant_id')
    .eq('id', gate.orgId)
    .single()

  return NextResponse.json({
    caller_languages:     org?.caller_languages     ?? ['en'],
    owner_language:       org?.owner_language       ?? 'en',
    notification_channel: org?.notification_channel ?? 'sms',
    owner_notify_e164:    org?.owner_notify_e164    ?? null,
    // Read-only context: lets the UI say whether a caller-language
    // change applies to a live line now or at first provisioning.
    has_assistant:        !!org?.call_agent_assistant_id,
  })
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await requireRole(supabase, user.id, OWNER_ONLY)
  if (isDenied(gate)) return gate.response

  let rawBody: unknown
  try { rawBody = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const parsed = patchSchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }
  const updates = parsed.data

  const dbUpdates: Record<string, unknown> = {}
  if ('caller_languages'     in updates) dbUpdates.caller_languages     = updates.caller_languages
  if ('owner_language'       in updates) dbUpdates.owner_language       = updates.owner_language
  if ('notification_channel' in updates) dbUpdates.notification_channel = updates.notification_channel
  if ('owner_notify_e164'    in updates) dbUpdates.owner_notify_e164    = updates.owner_notify_e164

  if (Object.keys(dbUpdates).length === 0) {
    return NextResponse.json({ error: 'No valid fields provided' }, { status: 400 })
  }

  // Only pay for a Vapi round-trip when the caller-language set truly
  // changed — owner_language / channel / mobile edits don't touch the
  // assistant. Compare against the current row (order-insensitive).
  let callerLangsChanged = false
  if (updates.caller_languages) {
    const { data: cur } = await supabase
      .from('organizations')
      .select('caller_languages')
      .eq('id', gate.orgId)
      .single()
    const before = new Set<string>((cur?.caller_languages as string[] | null) ?? ['en'])
    const after  = new Set<string>(updates.caller_languages)
    callerLangsChanged = before.size !== after.size || [...after].some((l) => !before.has(l))
  }

  const { error } = await supabaseAdmin
    .from('organizations')
    .update(dbUpdates as TablesUpdate<'organizations'>)
    .eq('id', gate.orgId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Best-effort live sync AFTER the save so the DB is always the
  // source of truth. syncInboundAssistant never throws; 'not_seeded'
  // is the normal pre-provisioning state and not worth a UI warning.
  // null = no sync attempted / not applicable (no assistant yet);
  // true/false = attempted and succeeded/failed.
  let assistantSynced: boolean | null = null
  if (callerLangsChanged) {
    const sync = await syncInboundAssistant({ supabase: supabaseAdmin, orgId: gate.orgId })
    if (sync.synced)                        assistantSynced = true
    else if (sync.reason === 'not_seeded')  assistantSynced = null
    else                                    assistantSynced = false
  }

  return NextResponse.json({ ok: true, assistant_synced: assistantSynced })
}
