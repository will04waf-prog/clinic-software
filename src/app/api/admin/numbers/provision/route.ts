/**
 * Phase 5 M2 — POST /api/admin/numbers/provision
 *
 * Owner-facing endpoint that enqueues a number-buy job for the
 * caller's org. The actual Twilio purchase + Vapi registration
 * happens asynchronously in the M5 provisioning_jobs queue, so this
 * route does no external HTTP — it only validates preconditions and
 * inserts a row.
 *
 * Why async (queue) instead of buying inline:
 *   - Twilio buys + Vapi registers + status writeback are a multi-
 *     step pipeline that needs durable retries. Doing it inline
 *     would mean a 503 mid-pipeline strands the operator with a
 *     half-provisioned org (Twilio number paid for, no Vapi binding).
 *   - The buy has billing consequences. We want a clear audit row
 *     (provisioning_jobs) before the money moves so refunds and
 *     re-runs are explicit.
 *   - The M5 step handler can choose the right Stripe customer +
 *     read the org's configured area-code/preferences without
 *     re-deriving them from the request body.
 *
 * Preconditions enforced here (return 409 with a typed code):
 *   - org.call_agent_assistant_id must be set. The Vapi registration
 *     step (later in the pipeline) needs an assistant id to bind the
 *     phone-number to. We could auto-seed one on the fly, but for M2
 *     we leave that to the operator (run scripts/seed-vapi-assistant.ts
 *     manually) — auto-seeding during onboarding is a future task.
 *   - org.vapi_phone_number_id must be NULL. If a number is already
 *     attached, a second buy would double-bill and orphan the first
 *     resource. The operator must explicitly release the existing
 *     number (DELETE /api/admin/numbers/[id], future) before re-
 *     provisioning.
 *
 * The (org, step) partial-unique index on provisioning_jobs covers
 * the concurrent-enqueue race: if two browser tabs both click "buy"
 * we insert raises 23505 on the second one and we map that to 409.
 *
 * Body: { e164: string (E.164) }
 * Response:
 *   200 { job_id, status: 'pending' }
 *   400 invalid input
 *   401 unauthenticated
 *   403 not an owner
 *   409 conflict (already-provisioned / no-assistant / queue-busy)
 *   500 db error
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requireRole, OWNER_ONLY, isDenied } from '@/lib/auth/roles'
import { blockedReason } from '@/lib/billing/org-access'

const bodySchema = z.object({
  // E.164 — same regex used elsewhere in the codebase for phone
  // validation (+ country code, 7-15 digits). Twilio's
  // AvailablePhoneNumbers API returns numbers in this exact format.
  e164: z.string().regex(/^\+[1-9]\d{6,14}$/, { message: 'invalid_e164' }),
}).strict()

export async function POST(req: NextRequest) {
  // ── 1. Auth ────────────────────────────────────────────────
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const gate = await requireRole(supabase, user.id, OWNER_ONLY)
  if (isDenied(gate)) return gate.response
  const { orgId } = gate

  // ── 2. Body ────────────────────────────────────────────────
  let raw: unknown
  try { raw = await req.json() } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_input', message: parsed.error.issues[0]?.message ?? 'invalid_input' },
      { status: 400 },
    )
  }
  const { e164 } = parsed.data

  // ── 3. Org preconditions ───────────────────────────────────
  // Read via supabaseAdmin (service role) — the caller is already
  // gated to owner of THIS org by requireRole. We don't need RLS
  // here because we're not exposing other orgs' data; reading
  // through the user-context client would also work but would add
  // round-trips for a column-by-column read that owner-RLS allows.
  const { data: org, error: orgErr } = await supabaseAdmin
    .from('organizations')
    .select('id, name, call_agent_assistant_id, vapi_phone_number_id, twilio_phone_sid, plan_status, trial_ends_at')
    .eq('id', orgId)
    .single()

  if (orgErr || !org) {
    // Shouldn't happen — requireRole already validated profile.organization_id.
    // But surface 500 over 404 so the dashboard alerts on the unexpected case.
    console.error('[admin/numbers/provision] org lookup failed', { orgId, err: orgErr?.message })
    return NextResponse.json({ error: 'internal_error' }, { status: 500 })
  }

  // Plan lockout: buying a number commits the platform to recurring
  // Twilio rent. The proxy exempts /onboarding so blocked owners can
  // still navigate, which means this route must gate itself.
  const lock = blockedReason(org.plan_status, org.trial_ends_at)
  if (lock) {
    return NextResponse.json(
      { error: 'plan_locked', message: `Your plan is ${lock.replace('_', ' ')} — subscribe to provision a phone number.` },
      { status: 403 },
    )
  }

  if (!org.call_agent_assistant_id) {
    return NextResponse.json(
      {
        error: 'assistant_not_seeded',
        message: 'Seed the inbound assistant first (scripts/seed-vapi-assistant.ts).',
      },
      { status: 409 },
    )
  }

  if (org.vapi_phone_number_id) {
    return NextResponse.json(
      {
        error: 'number_already_provisioned',
        message: 'This clinic already has a phone number on file. Release the existing one before buying a new one.',
      },
      { status: 409 },
    )
  }

  // ── 4. Enqueue the job ─────────────────────────────────────
  // step='buy_twilio_number' — first step of the M5 pipeline. The
  // canonical step taxonomy is buy_twilio_number → register_vapi_phone
  // → register_a2p_brand → register_a2p_campaign. The M3 onboarding
  // UI's PROVISIONING_STEPS const + the M5 STEP_HANDLERS keys both
  // expect these exact names — keep in lockstep.
  //
  // The (org, step) partial-unique index excludes 'failed' rows from
  // the constraint, so if an earlier twilio_buy attempt failed the
  // operator gets a clean re-enqueue. If a previous attempt is still
  // pending / in_progress / succeeded, the INSERT raises 23505 and
  // we surface 409 — the queue is the source of truth, not this API.
  const payload = {
    e164,
    // Capture the requesting user for audit. PHI-light: just the
    // user id, not the email or name; the dashboard can join.
    requested_by_user_id: user.id,
  }

  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from('provisioning_jobs')
    .insert({
      organization_id: orgId,
      step:            'buy_twilio_number',
      status:          'pending',
      payload,
    })
    .select('id')
    .single()

  if (insertErr) {
    // 23505 = unique_violation on provisioning_jobs_one_active_per_step_uniq.
    // A pending/in_progress/succeeded twilio_buy already exists for
    // this org. Treat as 409, NOT a retry — the operator should look
    // at the existing job in /admin/numbers.
    // Supabase-js surfaces the pg code on err.code.
    if ((insertErr as { code?: string }).code === '23505') {
      return NextResponse.json(
        {
          error: 'provisioning_already_pending',
          message: 'A number purchase is already pending for this clinic. Check the admin dashboard for progress.',
        },
        { status: 409 },
      )
    }
    console.error('[admin/numbers/provision] insert failed', { orgId, err: insertErr.message })
    return NextResponse.json({ error: 'internal_error' }, { status: 500 })
  }

  return NextResponse.json({ job_id: inserted.id, status: 'pending' as const })
}
