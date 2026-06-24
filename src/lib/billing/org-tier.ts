// ============================================================
// Effective-tier resolver — single source of truth for
// (plan, plan_status, trial_ends_at) → EffectiveTier mapping.
// ============================================================
//
// Imported by:
//   - require-tier.ts                  (route helper for API gates)
//   - auto-send.ts                     (runtime tier gate)
//   - server components rendering UI conditionally on tier
//   - admin views
//
// Rules:
//   - trial (with trial_ends_at > now) → Scale-equivalent.
//     Existing proxy.ts blocks trial_expired before requests reach here,
//     so we treat any 'trial' plan_status with a future trial_ends_at
//     (or null, which is the "still in trial, no expiry set yet" case)
//     as Scale.
//   - past_due grants the PLAN's actual tier (grace period — no upgrade).
//   - Known plans map to their tier as defined in enforce-tier.ts:
//       starter           → starter
//       professional/pro  → professional
//       scale             → scale
//       canceled          → starter (least access)
//   - Unknown / null / unrecognized plan → starter (fail-safe default).
//
// This module performs NO Stripe calls and NEVER rewrites the plan
// column. It is a pure mapper plus a read-only DB fetcher.

import { TIER_LIMITS, type TierId, type TierLimits } from '@/lib/billing/tiers'

export type EffectiveTierReason =
  | 'plan'
  | 'trial'
  | 'past_due_grace'
  | 'fallback_starter'

export interface EffectiveTier {
  tier:   TierId
  limits: TierLimits
  reason: EffectiveTierReason
}

// Allowlist of recognized plans. Kept locally to avoid a hard import
// cycle with enforce-tier.ts; the two sets must drift together if the
// DB CHECK constraint changes.
const KNOWN_PLANS = new Set(['starter', 'professional', 'pro', 'trial', 'scale', 'canceled'])

function planTierBase(plan: string | null | undefined): TierId | null {
  switch (plan) {
    case 'starter':      return 'starter'
    case 'scale':        return 'scale'
    case 'professional':
    case 'pro':
    case 'trial':        return 'professional'
    case 'canceled':     return 'starter'
    default:             return null
  }
}

/**
 * Pure mapping function — no I/O. Encodes the trial-equivalent-to-Scale
 * rule and the unknown-plan-defaults-to-Starter (fail-safe) rule.
 *
 * @param plan          organizations.plan (e.g. 'starter', 'professional', 'scale')
 * @param planStatus    organizations.plan_status (e.g. 'active', 'trial', 'past_due', 'trial_expired')
 * @param trialEndsAt   organizations.trial_ends_at (ISO string or null)
 * @param now           optional clock injection (tests). Defaults to Date.now().
 */
export function effectiveTierFor(
  plan:        string | null | undefined,
  planStatus:  string | null | undefined,
  trialEndsAt: string | null | undefined,
  now:         Date = new Date(),
): EffectiveTier {
  // Trial-window check: plan_status='trial' AND trial_ends_at is in the
  // future (or null — "trial just started, expiry not yet set"). The
  // expire-trials cron flips plan_status to 'trial_expired' once the
  // window closes, and proxy.ts blocks those requests before they
  // reach feature routes, so we never see an expired trial here in
  // practice. Defensive check anyway.
  if (planStatus === 'trial') {
    // Require a parseable, future trial_ends_at. A null or unparseable
    // value means the trial row was never properly initialized — fail
    // safe (fall through to plan-based mapping → likely starter)
    // instead of silently granting Scale-equivalent.
    const inWindow =
      trialEndsAt != null &&
      !Number.isNaN(Date.parse(trialEndsAt)) &&
      new Date(trialEndsAt).getTime() > now.getTime()
    if (inWindow) {
      return { tier: 'scale', limits: TIER_LIMITS.scale, reason: 'trial' }
    }
    // Trial window has lapsed (or is missing). Fall through to plan-
    // based mapping; the expire-trials cron will catch up shortly.
  }

  const base = planTierBase(plan)

  // Unknown / null / unrecognized plan → starter (fail-safe).
  if (base === null || (plan != null && !KNOWN_PLANS.has(plan))) {
    return { tier: 'starter', limits: TIER_LIMITS.starter, reason: 'fallback_starter' }
  }

  // past_due grants the plan's actual tier as a grace period.
  // Distinct reason so the audit log can tell why the org is on tier X.
  if (planStatus === 'past_due') {
    return { tier: base, limits: TIER_LIMITS[base], reason: 'past_due_grace' }
  }

  return { tier: base, limits: TIER_LIMITS[base], reason: 'plan' }
}

/**
 * Convenience wrapper for callers that already have an organizations row
 * in hand (e.g. inside attemptAutoSend's fresh org-row read).
 */
export function tierLimitsForOrg(
  orgRow: {
    plan?:           string | null
    plan_status?:    string | null
    trial_ends_at?:  string | null
  },
): EffectiveTier {
  return effectiveTierFor(
    orgRow.plan ?? null,
    orgRow.plan_status ?? null,
    orgRow.trial_ends_at ?? null,
  )
}

/**
 * One-shot DB fetcher. Selects (plan, plan_status, trial_ends_at) for
 * the given org and resolves to an EffectiveTier. Returns null if the
 * org row can't be found (caller should treat as 404, NOT as Starter —
 * a missing org is a routing bug, not a downgrade).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchOrgTier(supabase: any, orgId: string): Promise<EffectiveTier | null> {
  const { data, error } = await supabase
    .from('organizations')
    .select('plan, plan_status, trial_ends_at')
    .eq('id', orgId)
    .single()
  if (error || !data) return null
  return effectiveTierFor(
    data.plan ?? null,
    data.plan_status ?? null,
    data.trial_ends_at ?? null,
  )
}

/**
 * Type-safe capability lookup. Just a `limits[key] === true` check, but
 * routed through a helper so the audit story is consistent: every
 * capability gate goes through hasCapability().
 */
export function hasCapability(limits: TierLimits, key: keyof TierLimits): boolean {
  return limits[key] === true
}
