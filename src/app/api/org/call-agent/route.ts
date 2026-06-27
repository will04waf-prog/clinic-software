/**
 * Phase 5 W1 — GET/PATCH /api/org/call-agent.
 *
 * Owner-only (call-agent config has billing + compliance
 * implications). Gated by allowsCallAgent capability so non-Scale
 * orgs see the locked card.
 *
 * Compliance gate: call_agent_enabled cannot be flipped true unless
 * call_agent_baa_attested_at IS NOT NULL. The PATCH refuses the
 * mutation with a clear 409 error; the UI shows a separate
 * "attest BAA" toggle that sets baa_attested_at to now() when
 * checked.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requireRole, isDenied, OWNER_ONLY } from '@/lib/auth/roles'
import { requireCapability } from '@/lib/billing/require-tier'
import { z } from 'zod'

const E164_RE = /^\+[1-9]\d{6,14}$/
const HHMM_RE = /^([01][0-9]|2[0-3]):[0-5][0-9]$/

const businessHoursSchema = z.record(
  z.string().regex(/^[0-6]$/),
  z.array(z.object({
    start: z.string().regex(HHMM_RE),
    end:   z.string().regex(HHMM_RE),
  })),
).optional().nullable()

const patchSchema = z.object({
  call_agent_enabled:           z.boolean().optional(),
  call_agent_mode:              z.enum(['off', 'after_hours', 'always']).optional(),
  call_agent_fallback_e164:     z.string().regex(E164_RE).nullable().optional(),
  call_agent_business_hours:    businessHoursSchema,
  call_agent_greeting:          z.string().max(300).nullable().optional(),
  call_agent_baa_attested:      z.boolean().optional(),
  // Phase 5 W2 outbound AI reminder toggles. lead_hours is clamped
  // here to match the DB CHECK (2..72) so a malformed PATCH 400s at
  // the API layer instead of surfacing as an opaque Postgres
  // constraint violation. Enabling the toggle does NOT require the
  // BAA gate independently — call_agent_enabled already enforces
  // it, and an org cannot turn voice_reminder_enabled on without
  // call_agent_enabled being on too (the UI keeps the reminder
  // toggle disabled until the agent is live).
  voice_reminder_enabled:       z.boolean().optional(),
  voice_reminder_lead_hours:    z.number().int().min(2).max(72).optional(),
  // TCPA: setting this to true stamps voice_reminder_consent_attested_at
  // with now(); false clears it. Independent of BAA (different legal
  // surface — robocall consent is §227(b)(1)(A); HIPAA BAA is a
  // separate contract with Vapi).
  voice_reminder_consent_attested: z.boolean().optional(),
}).strict()

export async function GET() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await requireRole(supabase, user.id, OWNER_ONLY)
  if (isDenied(gate)) return gate.response

  const cap = await requireCapability(supabase, gate.orgId, 'allowsCallAgent')
  if (!cap.ok) return cap.response

  const { data: org } = await supabase
    .from('organizations')
    .select(`
      twilio_phone_number,
      call_agent_enabled, call_agent_mode, call_agent_fallback_e164,
      call_agent_business_hours, call_agent_greeting,
      call_agent_assistant_id, call_agent_voice_id,
      call_agent_baa_attested_at,
      voice_reminder_enabled, voice_reminder_lead_hours,
      voice_reminder_consent_attested_at,
      call_agent_reminder_assistant_id
    `)
    .eq('id', gate.orgId)
    .single()

  return NextResponse.json({
    twilio_phone_number:       org?.twilio_phone_number       ?? null,
    call_agent_enabled:        org?.call_agent_enabled        ?? false,
    call_agent_mode:           org?.call_agent_mode           ?? 'off',
    call_agent_fallback_e164:  org?.call_agent_fallback_e164  ?? null,
    call_agent_business_hours: org?.call_agent_business_hours ?? null,
    call_agent_greeting:       org?.call_agent_greeting       ?? null,
    call_agent_assistant_id:   org?.call_agent_assistant_id   ?? null,
    call_agent_voice_id:       org?.call_agent_voice_id       ?? null,
    call_agent_baa_attested_at: org?.call_agent_baa_attested_at ?? null,
    voice_reminder_enabled:    org?.voice_reminder_enabled    ?? false,
    voice_reminder_lead_hours: org?.voice_reminder_lead_hours ?? 24,
    voice_reminder_consent_attested_at: org?.voice_reminder_consent_attested_at ?? null,
    call_agent_reminder_assistant_id: org?.call_agent_reminder_assistant_id ?? null,
  })
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await requireRole(supabase, user.id, OWNER_ONLY)
  if (isDenied(gate)) return gate.response

  const cap = await requireCapability(supabase, gate.orgId, 'allowsCallAgent')
  if (!cap.ok) return cap.response

  let rawBody: unknown
  try { rawBody = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const parsed = patchSchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }
  const updates = parsed.data

  // Map call_agent_baa_attested (boolean) onto the timestamp column:
  // true → now(), false → null. Done client-side so the UI gets a
  // simple checkbox; the column stays a timestamp for audit.
  const dbUpdates: Record<string, unknown> = {}
  if ('call_agent_enabled'        in updates) dbUpdates.call_agent_enabled        = updates.call_agent_enabled
  if ('call_agent_mode'           in updates) dbUpdates.call_agent_mode           = updates.call_agent_mode
  if ('call_agent_fallback_e164'  in updates) dbUpdates.call_agent_fallback_e164  = updates.call_agent_fallback_e164
  if ('call_agent_business_hours' in updates) dbUpdates.call_agent_business_hours = updates.call_agent_business_hours
  if ('call_agent_greeting'       in updates) dbUpdates.call_agent_greeting       = updates.call_agent_greeting
  if ('call_agent_baa_attested'   in updates) {
    dbUpdates.call_agent_baa_attested_at = updates.call_agent_baa_attested
      ? new Date().toISOString()
      : null
  }
  if ('voice_reminder_enabled'    in updates) dbUpdates.voice_reminder_enabled    = updates.voice_reminder_enabled
  if ('voice_reminder_lead_hours' in updates) dbUpdates.voice_reminder_lead_hours = updates.voice_reminder_lead_hours
  if ('voice_reminder_consent_attested' in updates) {
    dbUpdates.voice_reminder_consent_attested_at = updates.voice_reminder_consent_attested
      ? new Date().toISOString()
      : null
  }

  // TCPA gate. voice_reminder_enabled cannot be flipped true unless
  // the post-write state shows voice_reminder_consent_attested_at IS
  // NOT NULL. Mirrors the BAA gate above.
  if (updates.voice_reminder_enabled === true) {
    let willHaveConsent: boolean
    if ('voice_reminder_consent_attested' in updates) {
      willHaveConsent = updates.voice_reminder_consent_attested === true
    } else {
      const { data: cur } = await supabase
        .from('organizations')
        .select('voice_reminder_consent_attested_at')
        .eq('id', gate.orgId)
        .single()
      willHaveConsent = cur?.voice_reminder_consent_attested_at != null
    }
    if (!willHaveConsent) {
      return NextResponse.json(
        {
          error: 'voice_consent_required',
          message: 'You must attest that you have prior express consent from your patients for automated reminder calls before enabling this feature.',
        },
        { status: 409 },
      )
    }
  }

  // ── BAA gate. ──
  // Check the FINAL state after this PATCH lands, not the current row
  // state. Without that, a single request {enabled:true, baa_attested:
  // false} would: pass the gate (DB row currently attested), then run
  // the UPDATE which clears attested_at AND sets enabled=true,
  // leaving the row in an unattestation-bypass state.
  if (updates.call_agent_enabled === true) {
    let willHaveBaa: boolean
    if ('call_agent_baa_attested' in updates) {
      // Same payload sets attested explicitly — use that value as the
      // post-write truth.
      willHaveBaa = updates.call_agent_baa_attested === true
    } else {
      // Payload doesn't touch attested — fall back to current DB state.
      const { data: cur } = await supabase
        .from('organizations')
        .select('call_agent_baa_attested_at')
        .eq('id', gate.orgId)
        .single()
      willHaveBaa = cur?.call_agent_baa_attested_at != null
    }
    if (!willHaveBaa) {
      return NextResponse.json(
        {
          error: 'baa_required',
          message: 'You must attest that a Business Associate Agreement is on file with Vapi before enabling the call agent.',
        },
        { status: 409 },
      )
    }
  }

  if (Object.keys(dbUpdates).length === 0) {
    return NextResponse.json({ error: 'No valid fields provided' }, { status: 400 })
  }

  const { error } = await supabaseAdmin
    .from('organizations')
    .update(dbUpdates)
    .eq('id', gate.orgId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
