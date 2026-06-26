/**
 * Phase 4 W8 — shared role primitives for API gating.
 *
 * Why a helper instead of inlining role checks per route:
 *   - One place to define what "owner-only" means. The set was
 *     drifting across the codebase (booking routes used
 *     {owner,admin,staff}; auto-send-settings used {owner,admin};
 *     billing had no gate at all).
 *   - One place to deactivate-block. is_active=false rejects with 403
 *     here, so every gated route automatically excludes soft-deleted
 *     users without each one re-implementing the check.
 *   - One place to fail consistently. requireRole returns either the
 *     resolved {orgId, role} pair or a ready-to-return NextResponse,
 *     matching the shape of src/lib/billing/require-tier.ts so the
 *     call site reads the same way.
 *
 * Usage:
 *
 *   const gate = await requireRole(supabase, user.id, OWNER_ADMIN)
 *   if ('response' in gate) return gate.response
 *   const { orgId, role } = gate
 *
 * The helper is API-layer only. It does NOT relax RLS — the
 * org_isolation policy still narrows to the user's org. Roles are an
 * additional gate ON TOP of that, not a replacement.
 */

import type { NextResponse } from 'next/server'
import { NextResponse as NR } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'

export type ProfileRole = 'owner' | 'admin' | 'staff'

/**
 * Canonical role tiers. Don't compose ad-hoc sets at call sites —
 * import one of these so the privilege model stays auditable from
 * a single file.
 */
export const OWNER_ONLY:        ReadonlySet<ProfileRole> = new Set<ProfileRole>(['owner'])
export const OWNER_ADMIN:       ReadonlySet<ProfileRole> = new Set<ProfileRole>(['owner', 'admin'])
export const OWNER_ADMIN_STAFF: ReadonlySet<ProfileRole> = new Set<ProfileRole>(['owner', 'admin', 'staff'])

export interface RoleOk {
  orgId: string
  role:  ProfileRole
}
export interface RoleDenied {
  response: NextResponse
}
export type RoleResult = RoleOk | RoleDenied

/**
 * Resolve the caller's role + org, and gate against `allowed`.
 * Returns the {orgId, role} pair on success, OR a NextResponse to
 * return immediately on denial.
 *
 * Denial reasons + status codes:
 *   - profile not found        → 404 (orphan auth user — shouldn't
 *                                happen but better to surface than
 *                                silently 500)
 *   - profile.is_active=false  → 403 ("Your account is deactivated")
 *   - role not in allowed set  → 403 ("Only owners/admins can ...")
 *
 * Caller has already auth'd the user via supabase.auth.getUser() and
 * should return 401 BEFORE calling this helper.
 */
export async function requireRole(
  supabase: SupabaseClient,
  userId: string,
  allowed: ReadonlySet<ProfileRole>,
): Promise<RoleResult> {
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('organization_id, role, is_active')
    .eq('id', userId)
    .single()

  if (error || !profile) {
    return {
      response: NR.json({ error: 'Profile not found' }, { status: 404 }),
    }
  }

  if (profile.is_active === false) {
    // Hard 403 with no role detail — a deactivated user shouldn't be
    // able to enumerate which routes they would have had access to.
    return {
      response: NR.json(
        { error: 'Account deactivated', message: 'This account has been deactivated by the clinic owner.' },
        { status: 403 },
      ),
    }
  }

  const role = profile.role as ProfileRole
  if (!allowed.has(role)) {
    const human = allowed === OWNER_ONLY
      ? 'Only the clinic owner can do this.'
      : allowed === OWNER_ADMIN
        ? 'Only owners or admins can do this.'
        : 'Your role does not have permission for this action.'
    return {
      response: NR.json({ error: 'Forbidden', message: human }, { status: 403 }),
    }
  }

  return {
    orgId: profile.organization_id as string,
    role,
  }
}

/**
 * Type guard helper so callers can write:
 *   if (isDenied(gate)) return gate.response
 *   const { orgId, role } = gate
 *
 * Equivalent to checking `'response' in gate` but reads clearer at
 * the call site.
 */
export function isDenied(result: RoleResult): result is RoleDenied {
  return 'response' in result
}
