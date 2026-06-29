'use server'

/**
 * Phase 5 M6 — server actions for /admin/numbers.
 *
 * The single action exposed here is retriggerProvisioning(orgId, step):
 * the super-admin clicks "Re-trigger" on a row that's stuck in a
 * BROKEN state (a2p rejected, no Vapi binding while reminders are
 * enabled, or stale silently), and we enqueue a fresh provisioning_jobs
 * row that M5's runner will drain on its next tick.
 *
 * Authorization model
 * ───────────────────
 * Super-admin only. Like every other admin API in the codebase, we do
 * NOT use requireRole() (which only knows about org-level owner/admin/
 * staff) — we read profile.is_super_admin via supabaseAdmin and fail
 * closed if false. This is the same pattern as
 * src/app/api/admin/accounts/[id]/route.ts and the /admin/layout.tsx
 * gate; defense-in-depth at the action layer means an authenticated
 * non-super user who somehow hits the action endpoint directly (e.g.
 * by reverse-engineering the form post body) still gets 403'd.
 *
 * Idempotency
 * ───────────
 * The provisioning_jobs table has a partial UNIQUE index on
 * (organization_id, step) WHERE status IN ('pending', 'in_progress',
 * 'succeeded'). That means re-enqueueing a step that's already pending
 * or succeeded should 23505. We don't want to silently overwrite a
 * succeeded row (it might have payload we care about for audit), and
 * we also don't want to double-enqueue a pending one. The shape of
 * "retrigger" we actually want for the super-admin dashboard is:
 *
 *   1. If the most recent row for (org, step) is 'failed' → INSERT a
 *      fresh 'pending' row. (Partial unique excludes failed, so this
 *      won't collide.)
 *   2. If the most recent row is 'pending' or 'in_progress' → no-op;
 *      report "already_queued".
 *   3. If the most recent row is 'succeeded' → first mark it 'failed'
 *      (so the partial unique no longer counts it), then INSERT a
 *      fresh 'pending'. This is the "rerun a step that previously
 *      worked but the operator wants to redo" path — useful for an
 *      A2P resubmission after Twilio flips a brand back to rejected.
 *   4. If no rows exist at all → INSERT a fresh 'pending'.
 *
 * That matches the migration's intent: a stuck job can be retried "by
 * inserting a fresh row (with attempts=0) without manual cleanup", and
 * we extend that to also handle the succeeded-but-still-need-to-redo
 * case explicitly so the super-admin doesn't have to crack open the
 * SQL editor.
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

// The set of step names M5's runner knows how to dispatch. Kept loose
// (text in the DB, not a CHECK) so M2/M5/M7 can each add steps without
// a migration — but the action surface still validates against the
// known set so the super-admin can't typo a step name into the queue.
const KNOWN_STEPS = [
  'buy_twilio_number',
  'register_vapi_phone',
  'register_a2p_brand',
  'register_a2p_campaign',
] as const
export type ProvisioningStep = (typeof KNOWN_STEPS)[number]

const retriggerSchema = z.object({
  orgId: z.string().uuid(),
  step:  z.enum(KNOWN_STEPS),
})

export type RetriggerResult =
  | { ok: true;  state: 'enqueued' | 'already_queued' | 'rerun_after_success' }
  | { ok: false; error: string }

async function requireSuperAdmin(): Promise<
  | { ok: true; userId: string }
  | { ok: false; error: string }
> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not authenticated' }

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('is_super_admin')
    .eq('id', user.id)
    .single()

  if (!profile?.is_super_admin) {
    return { ok: false, error: 'Forbidden' }
  }
  return { ok: true, userId: user.id }
}

export async function retriggerProvisioning(input: {
  orgId: string
  step:  string
}): Promise<RetriggerResult> {
  const auth = await requireSuperAdmin()
  if (!auth.ok) return auth

  const parsed = retriggerSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }
  const { orgId, step } = parsed.data

  // Most-recent row for (org, step). We need the row's status to
  // decide which branch to take.
  const { data: latest, error: latestErr } = await supabaseAdmin
    .from('provisioning_jobs')
    .select('id, status')
    .eq('organization_id', orgId)
    .eq('step', step)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (latestErr) {
    return { ok: false, error: latestErr.message }
  }

  if (latest && (latest.status === 'pending' || latest.status === 'in_progress')) {
    // Already in flight — don't pile on. The runner will pick it up
    // on its next tick. Returning 'already_queued' lets the UI render
    // a quiet "queued" toast instead of an error.
    return { ok: true, state: 'already_queued' }
  }

  if (latest && latest.status === 'succeeded') {
    // The partial UNIQUE excludes 'failed' but INCLUDES 'succeeded',
    // so a naive INSERT would collide. Demote the succeeded row to
    // 'failed' first (preserves its payload + last_error for audit;
    // the runner ignores failed rows) and then INSERT a fresh pending.
    const { error: demoteErr } = await supabaseAdmin
      .from('provisioning_jobs')
      .update({
        status:     'failed',
        last_error: 'superseded_by_manual_retrigger',
      })
      .eq('id', latest.id)
    if (demoteErr) {
      return { ok: false, error: demoteErr.message }
    }
    const { error: insertErr } = await supabaseAdmin
      .from('provisioning_jobs')
      .insert({
        organization_id: orgId,
        step,
        status:          'pending',
        attempts:        0,
      })
    if (insertErr) {
      return { ok: false, error: insertErr.message }
    }
    revalidatePath('/admin/numbers')
    return { ok: true, state: 'rerun_after_success' }
  }

  // Either no rows at all, or the most recent is 'failed'. Either
  // way the partial UNIQUE is clear; we can INSERT directly.
  const { error: insertErr } = await supabaseAdmin
    .from('provisioning_jobs')
    .insert({
      organization_id: orgId,
      step,
      status:          'pending',
      attempts:        0,
    })
  if (insertErr) {
    return { ok: false, error: insertErr.message }
  }
  revalidatePath('/admin/numbers')
  return { ok: true, state: 'enqueued' }
}
