// ============================================================
// Route-helper for Phase 2 API tier gates.
// ============================================================
//
// One-liner usage at the top of every gated API route:
//
//   const gate = await requireCapability(supabase, orgId, 'allowsVoiceTraining')
//   if (!gate.ok) return gate.response
//
// On failure: returns HTTP 402 (Payment Required) with the stable
// locked JSON shape. UI cards detect this shape via isLockedResponse()
// and swap themselves for <UpgradeCardLocked/>.
//
// 402 over 403: 402 is "not on your plan", 403 is "not allowed at all".
// enforce-tier.ts continues to use 403 for legit-but-overlimit cases —
// they answer a different question.

import { NextResponse } from 'next/server'
import {
  fetchOrgTier,
  hasCapability,
} from '@/lib/billing/org-tier'
import { type TierId, type TierLimits } from '@/lib/billing/tiers'

export type CapabilityKey = 'allowsVoiceTraining' | 'allowsAutonomousSend'

/**
 * The required tier for each gated capability. Drives both the locked
 * response payload (so the UI can render "Upgrade to {tier}") and the
 * /pricing deep-link anchor.
 */
export const REQUIRED_TIER_FOR: Record<CapabilityKey, TierId> = {
  allowsVoiceTraining:  'professional',
  allowsAutonomousSend: 'scale',
}

export interface LockedBody {
  locked:        true
  error:         'tier_required'
  required_tier: TierId
  current_tier:  TierId
  capability:    CapabilityKey
  upgrade_url:   '/pricing'
}

export type RequireResult =
  | { ok: true; tier: TierId; limits: TierLimits }
  | { ok: false; response: NextResponse<LockedBody> }

/**
 * Pure builder for the locked response body. Exported so the runtime
 * auto-send gate can stamp identical shape into its audit metadata,
 * and so unit tests can assert on the wire format without spinning
 * up a NextResponse.
 */
export function lockedResponseBody(
  key:         CapabilityKey,
  currentTier: TierId,
): LockedBody {
  return {
    locked:        true,
    error:         'tier_required',
    required_tier: REQUIRED_TIER_FOR[key],
    current_tier:  currentTier,
    capability:    key,
    upgrade_url:   '/pricing',
  }
}

/**
 * Resolves the effective tier for the org and returns either a usable
 * { ok: true, tier, limits } or a ready-to-return 402 NextResponse.
 *
 * Failure modes:
 *   - org not found              → 402 with current_tier='starter' (fail-safe)
 *   - capability not granted     → 402 with current_tier=<effective>
 *
 * A missing org row could arguably be a 404, but routing here implies
 * the user is authenticated and we already resolved the org id from
 * their profile, so a missing org row is treated as "no capability"
 * (fail-safe) rather than crashing the route.
 */
export async function requireCapability(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  orgId:    string,
  key:      CapabilityKey,
): Promise<RequireResult> {
  const eff = await fetchOrgTier(supabase, orgId)

  if (!eff) {
    const body = lockedResponseBody(key, 'starter')
    return {
      ok: false,
      response: NextResponse.json<LockedBody>(body, { status: 402 }),
    }
  }

  if (!hasCapability(eff.limits, key)) {
    const body = lockedResponseBody(key, eff.tier)
    return {
      ok: false,
      response: NextResponse.json<LockedBody>(body, { status: 402 }),
    }
  }

  return { ok: true, tier: eff.tier, limits: eff.limits }
}
