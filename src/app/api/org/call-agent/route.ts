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
      call_agent_baa_attested_at
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

  // ── BAA gate. ──
  // If the caller is trying to flip call_agent_enabled to true,
  // verify either (a) the same payload also attests the BAA, or
  // (b) baa_attested_at is already set on the row.
  if (updates.call_agent_enabled === true) {
    const willHaveBaa =
      updates.call_agent_baa_attested === true ||
      (await (async () => {
        const { data: cur } = await supabase
          .from('organizations')
          .select('call_agent_baa_attested_at')
          .eq('id', gate.orgId)
          .single()
        return cur?.call_agent_baa_attested_at != null
      })())
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
