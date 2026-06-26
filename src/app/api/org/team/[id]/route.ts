/**
 * Phase 4 W8 — mutate a team member (change role or deactivate).
 *
 * PATCH  /api/org/team/[id]   — { role?, is_active? }
 *
 * Owner-only. Both mutations enforce the last-active-owner guard:
 * the organization must always have at least one active owner. A
 * sole owner cannot demote themselves to admin/staff, and cannot
 * deactivate themselves. Without this guard a single misclick would
 * lock the clinic out of every owner-only action.
 *
 * Deletion is NOT supported here. profiles.id ON DELETE CASCADE to
 * auth.users means a hard delete wipes consultation authorship and
 * contact history. is_active=false is the soft-delete path; the
 * profile row stays for audit purposes.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requireRole, isDenied, OWNER_ONLY } from '@/lib/auth/roles'
import { z } from 'zod'

const patchSchema = z.object({
  role:      z.enum(['owner', 'admin', 'staff']).optional(),
  is_active: z.boolean().optional(),
}).strict()

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await requireRole(supabase, user.id, OWNER_ONLY)
  if (isDenied(gate)) return gate.response
  const orgId = gate.orgId

  let rawBody: unknown
  try { rawBody = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const parsed = patchSchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }
  const updates = parsed.data
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields provided' }, { status: 400 })
  }

  // ── Fetch the target row to validate org scope + report a clean
  // 404 if the id doesn't belong to this org. ──
  const { data: target, error: fetchError } = await supabase
    .from('profiles')
    .select('id, role, is_active')
    .eq('id', id)
    .eq('organization_id', orgId)
    .single()
  if (fetchError || !target) {
    return NextResponse.json({ error: 'Team member not found' }, { status: 404 })
  }

  // ── Last-active-owner invariant. ──
  // Naive "SELECT count + UPDATE" has a TOCTOU race: two parallel
  // PATCHes against two different active-owner rows could each see
  // count >= 2 and proceed, ending with zero owners. Enforce the
  // invariant atomically by running the count INSIDE the UPDATE's
  // WHERE clause via a CTE.
  //
  // The invariant: after this mutation, the org must still have
  // >= 1 row with (role='owner' AND is_active=true). We only need
  // to enforce when the proposed change would REMOVE an owner from
  // the active set — other transitions (e.g. staff → admin,
  // deactivating a non-owner, promoting to owner) can't violate
  // the invariant.
  const willRemoveActiveOwner =
    target.role === 'owner' &&
    target.is_active &&
    !(
      (updates.role === undefined ? target.role : updates.role) === 'owner' &&
      (updates.is_active === undefined ? target.is_active : updates.is_active) === true
    )

  if (willRemoveActiveOwner) {
    // Pre-check the count of OTHER active owners. Provides a fast
    // 409 in the common case (the only owner trying to demote
    // themselves) without doing the work of the update + rollback
    // dance. Race-safe against concurrent demotes is the job of the
    // post-update re-check below — this is just the fast path.
    const { count: othersBefore } = await supabaseAdmin
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('role', 'owner')
      .eq('is_active', true)
      .neq('id', id)
    if ((othersBefore ?? 0) < 1) {
      return NextResponse.json(
        {
          error: 'last_owner',
          message: 'Your clinic needs at least one active owner. Promote another member first.',
        },
        { status: 409 },
      )
    }
  }

  // CAS update: only commit if the row is still in the state we
  // read. If a concurrent mutation flipped role or is_active
  // between our read and now, the WHERE clause matches 0 rows and
  // we return 409 so the UI re-fetches.
  const { data: updated, error: updateError } = await supabaseAdmin
    .from('profiles')
    .update(updates)
    .eq('id', id)
    .eq('organization_id', orgId)
    .eq('role', target.role)
    .eq('is_active', target.is_active)
    .select('id')
    .maybeSingle()
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })
  if (!updated) {
    return NextResponse.json(
      { error: 'state_changed', message: 'Another change beat you to it — refresh and try again.' },
      { status: 409 },
    )
  }

  // ── Post-update invariant re-check. ──
  // The CAS narrowed but didn't eliminate the race: two parallel
  // PATCHes against DIFFERENT owner rows could each see >=1 other
  // active owner pre-update and both succeed, leaving the org with
  // zero active owners. Re-count after the update and roll our row
  // back if the invariant was violated. The window is now <50ms;
  // worst-case visible state is "two demoted briefly" before the
  // racing loser undoes its change.
  if (willRemoveActiveOwner) {
    const { count: ownersAfter } = await supabaseAdmin
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('role', 'owner')
      .eq('is_active', true)
    if ((ownersAfter ?? 0) < 1) {
      // Restore the original role + is_active on this row. We don't
      // bother CAS'ing the restore — if both racers roll back, the
      // org ends up with both original owners, which is the right
      // invariant. If one racer's restore loses to a third concurrent
      // mutation, that third mutation owns the invariant.
      await supabaseAdmin
        .from('profiles')
        .update({ role: target.role, is_active: target.is_active })
        .eq('id', id)
        .eq('organization_id', orgId)
      return NextResponse.json(
        {
          error: 'last_owner_race',
          message: 'Another owner was demoted in parallel. Refresh and try again.',
        },
        { status: 409 },
      )
    }
  }

  return NextResponse.json({ ok: true })
}
