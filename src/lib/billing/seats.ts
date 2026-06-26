/**
 * Phase 4 W9 — seat-cap enforcement for the team invitation flow.
 *
 * Builds on top of the W8 invitations system. The owner-only invite
 * POST and the /accept-invite handler both call requireSeatAvailable
 * before mutating profiles or accepting an invitation.
 *
 * Seat-cap math: an org's "used seats" is
 *
 *     count(profiles WHERE org=$1 AND is_active=true)
 *   + count(team_invitations WHERE org=$1 AND accepted_at IS NULL
 *                                AND revoked_at  IS NULL
 *                                AND expires_at  > now())
 *
 * The pending-invite half is critical: without it an owner could
 * issue 100 invites at Starter cap=2 and they'd all succeed until
 * the first 2 accepts, blowing past the cap. Adding pending invites
 * to the count tightens invite-time enforcement (accept-time math
 * still re-runs for race safety).
 *
 * Trial-downgrade safety: existing teammates are GRANDFATHERED. We
 * only block NEW invites/accepts that would push count past cap. An
 * org that trial→Starter and is over-seated stays functional; the
 * owner just can't add more until they deactivate or upgrade.
 *
 * Returns the same 402 LockedBody shape as requireCapability so
 * UpgradeCardLocked + isLockedResponse() work without changes.
 */

import { NextResponse } from 'next/server'
import { fetchOrgTier } from '@/lib/billing/org-tier'
import { type TierId } from '@/lib/billing/tiers'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface SeatLockedBody {
  locked:        true
  error:         'seat_cap_reached'
  /** Human-readable copy. The accept-invite page renders this to the
   *  invitee verbatim — owner-side flows render UpgradeCardLocked
   *  instead. The wording assumes the reader is the invitee, not the
   *  owner, because the only post-launch path that surfaces this
   *  body in user-facing UI is the accept page. */
  message:       string
  required_tier: TierId
  current_tier:  TierId
  capability:    'team_seats'
  upgrade_url:   '/pricing'
  /** Useful for UX copy: "You're at 5 of 5 seats." */
  current_seats: number
  cap:           number
}

export type SeatResult =
  | { ok: true; tier: TierId; used: number; cap: number }
  | { ok: false; response: NextResponse<SeatLockedBody> }

/**
 * Returns the next tier up that has a higher seat cap than the
 * current one. Starter→Pro, Pro→Scale. If already Scale, returns
 * 'scale' (the UI's upgrade CTA falls back to a "you're on the top
 * tier" copy block).
 */
function nextTierForSeats(current: TierId): TierId {
  if (current === 'starter')      return 'professional'
  if (current === 'professional') return 'scale'
  return 'scale'
}

/**
 * Count active profiles + pending invitations for an org. Both
 * counted via {count:'exact', head:true} so the round-trip stays
 * cheap (no row payload). Exported separately so the GET
 * /api/org/team/seats endpoint can render the indicator.
 */
export async function countActiveSeats(
  supabase: SupabaseClient,
  orgId: string,
): Promise<{ active: number; pending: number; total: number }> {
  const nowIso = new Date().toISOString()
  const [profilesRes, invitesRes] = await Promise.all([
    supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('is_active', true),
    supabase
      .from('team_invitations')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .is('accepted_at', null)
      .is('revoked_at',  null)
      .gt('expires_at',  nowIso),
  ])
  const active  = profilesRes.count  ?? 0
  const pending = invitesRes.count   ?? 0
  return { active, pending, total: active + pending }
}

/**
 * Gate helper. Returns either { ok: true, ... } with usable state
 * or { ok: false, response } with a ready-to-return 402 NextResponse.
 *
 * Failure modes:
 *   - org not found → 402 with current_tier='starter' (fail-safe)
 *   - used >= cap   → 402 with the locked body
 *
 * Call AFTER requireRole(OWNER_ONLY) so we're not checking seats
 * for a non-authorized caller.
 */
export async function requireSeatAvailable(
  supabase: SupabaseClient,
  orgId: string,
): Promise<SeatResult> {
  // Super-admin bypass — mirrors requireCapability. The platform
  // owner / support engineers should be able to invite teammates
  // into any org regardless of seat caps.
  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_super_admin')
      .eq('id', user.id)
      .single()
    if (profile?.is_super_admin) {
      return { ok: true, tier: 'scale', used: 0, cap: Number.POSITIVE_INFINITY }
    }
  }

  const eff = await fetchOrgTier(supabase, orgId)
  if (!eff) {
    const body: SeatLockedBody = {
      locked:        true,
      error:         'seat_cap_reached',
      message:       'This clinic is not currently set up to add teammates. Ask the clinic owner to complete billing setup.',
      required_tier: 'professional',
      current_tier:  'starter',
      capability:    'team_seats',
      upgrade_url:   '/pricing',
      current_seats: 0,
      cap:           0,
    }
    return { ok: false, response: NextResponse.json<SeatLockedBody>(body, { status: 402 }) }
  }

  const { total } = await countActiveSeats(supabase, orgId)
  const cap = eff.limits.seatCap

  if (total >= cap) {
    const body: SeatLockedBody = {
      locked:        true,
      error:         'seat_cap_reached',
      message:       `This clinic is at its seat limit (${total} of ${cap}). Ask the clinic owner to upgrade their plan or free a seat before retrying.`,
      required_tier: nextTierForSeats(eff.tier),
      current_tier:  eff.tier,
      capability:    'team_seats',
      upgrade_url:   '/pricing',
      current_seats: total,
      cap,
    }
    return { ok: false, response: NextResponse.json<SeatLockedBody>(body, { status: 402 }) }
  }

  return { ok: true, tier: eff.tier, used: total, cap }
}
