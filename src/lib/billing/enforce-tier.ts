// ============================================================
// Tier enforcement layer (PR-TIERS-B Step 4)
// ============================================================
// Three exported helpers that gate feature access by org plan:
//   checkContactLimit(supabase, orgId)
//   checkBulkImportSize(supabase, orgId, rowCount)
//   checkFeatureAccess(supabase, orgId, feature)
//
// All three return an EnforceResult — either { ok: true } or
// { ok: false, status, error }. The result carries the HTTP status so
// callers do `NextResponse.json(check.error, { status: check.status })`
// without inspecting error contents:
//   403 → tier limit exceeded (TierLimitError)
//   500 → plan lookup failed (PlanLookupFailedError) — fail closed
//
// Plan → tier mapping (allowlist; anything outside is blocked):
//   trial / pro / professional → professional limits
//   starter                    → starter limits
//   scale                      → scale limits
//   canceled                   → blocked from all gated features
//   anything else              → blocked (treated like canceled)

import { TIER_LIMITS, type TierId } from '@/lib/billing/tiers'
import { getPlanByOrgId } from '@/lib/org-helpers'

export type GatedFeature =
  | 'automation'
  | 'bulk_import'
  | 'multi_location'
  | 'automated_reminders'

// Allowlist of known plan values. Must stay in sync with the
// organizations.plan CHECK constraint defined in
// supabase/migrations/20260502120100_add_plan_check_constraint.sql.
// If a future migration adds a new plan value, update this set too —
// unrecognized plans are blocked by isPlanBlocked() (fail-closed).
const KNOWN_PLANS = new Set([
  'starter',
  'professional',
  'pro',
  'trial',
  'scale',
  'canceled',
])

export interface TierLimitError {
  error:          'tier_limit_exceeded'
  limit:          'max_contacts' | 'bulk_import_size' | 'feature_access'
  current_tier:   TierId
  current_count?: number
  tier_max?:      number
  feature?:       string
  upgrade_url:    '/pricing'
}

export interface PlanLookupFailedError {
  error:       'plan_lookup_failed'
  upgrade_url: '/pricing'
}

export type EnforceResult =
  | { ok: true }
  | { ok: false; status: 403; error: TierLimitError }
  | { ok: false; status: 500; error: PlanLookupFailedError }

// ── Plan → tier mapping ─────────────────────────────────────

export function planToTier(plan: string | null | undefined): TierId {
  switch (plan) {
    case 'starter':      return 'starter'
    case 'scale':        return 'scale'
    case 'canceled':     return 'starter'  // display only — see isPlanBlocked
    case 'trial':
    case 'pro':
    case 'professional': return 'professional'
    default:
      // Unreachable: isPlanBlocked() rejects unknown plans before we get here.
      // If this fires, the plan allowlist drifted from the DB CHECK constraint.
      console.error(`[enforce-tier] unrecognized plan "${plan}" reached planToTier — treat as blocked`)
      return 'starter'
  }
}

export function isPlanBlocked(plan: string | null | undefined): boolean {
  if (plan === 'canceled') return true
  if (plan == null) return true
  if (!KNOWN_PLANS.has(plan)) {
    console.error(`[enforce-tier] unknown plan "${plan}" — blocking; allowlist drift vs DB CHECK constraint?`)
    return true
  }
  return false
}

function isFeatureAllowed(tier: TierId, feature: GatedFeature): boolean {
  const limits = TIER_LIMITS[tier]
  switch (feature) {
    case 'automation':          return limits.allowsAutomationSequences
    case 'bulk_import':         return limits.allowsBulkImport
    case 'multi_location':      return limits.allowsMultiLocation
    case 'automated_reminders': return limits.allowsAutomatedReminders
  }
}

/**
 * Sync feature-access check for callers that already have the plan string in
 * scope (e.g. the consultation-reminders cron, which fetches plan via the
 * org join). Avoids an extra DB round-trip per consultation.
 */
export function isFeatureAllowedForPlan(
  plan: string | null | undefined,
  feature: GatedFeature,
): boolean {
  if (isPlanBlocked(plan)) return false
  return isFeatureAllowed(planToTier(plan), feature)
}

// ── Internal helpers ────────────────────────────────────────

function blockedError(tier: TierId, feature: string): EnforceResult {
  return {
    ok:     false,
    status: 403,
    error:  {
      error:        'tier_limit_exceeded',
      limit:        'feature_access',
      current_tier: tier,
      feature,
      upgrade_url:  '/pricing',
    },
  }
}

function planLookupFailed(orgId: string): EnforceResult {
  console.error('[enforce-tier] plan lookup failed for org', orgId)
  return {
    ok:     false,
    status: 500,
    error:  {
      error:       'plan_lookup_failed',
      upgrade_url: '/pricing',
    },
  }
}

async function countActiveContacts(
  supabase: any,
  orgId: string,
): Promise<number | null> {
  const { count, error } = await supabase
    .from('contacts_active')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)

  if (error) {
    console.error('[enforce-tier] contact count failed:', error.message)
    return null
  }
  return count ?? 0
}

// ── Async checks ────────────────────────────────────────────

/**
 * Block the next contact insert if the org is at or above its tier's
 * maxContacts. Canceled orgs are blocked unconditionally.
 *
 * Race-safe contact counting deferred — under high concurrency two
 * simultaneous inserts can both pass the limit check. Acceptable at
 * current scale; revisit at 10+ concurrent writes/sec.
 */
export async function checkContactLimit(
  supabase: any,
  orgId: string,
): Promise<EnforceResult> {
  const info = await getPlanByOrgId(supabase, orgId)
  if (!info) return planLookupFailed(orgId)   // fail closed

  if (isPlanBlocked(info.plan)) {
    return blockedError(planToTier(info.plan), 'contact_create')
  }

  const tier = planToTier(info.plan)
  const max  = TIER_LIMITS[tier].maxContacts
  if (!Number.isFinite(max)) return { ok: true }   // unlimited (Scale)

  // Fail open on count errors — a transient DB hiccup shouldn't lock
  // out contact creation. The error is logged in countActiveContacts.
  const current = await countActiveContacts(supabase, orgId)
  if (current === null) return { ok: true }

  if (current >= max) {
    return {
      ok:     false,
      status: 403,
      error:  {
        error:         'tier_limit_exceeded',
        limit:         'max_contacts',
        current_tier:  tier,
        current_count: current,
        tier_max:      max,
        upgrade_url:   '/pricing',
      },
    }
  }
  return { ok: true }
}

/**
 * Block a bulk import that would either:
 *   1. require the bulk_import feature on a tier that doesn't have it
 *   2. push the org past its maxContacts ceiling
 *
 * Called once per import (chunk 0). Subsequent chunks proceed without
 * re-checking — total_rows is committed at chunk 0.
 */
export async function checkBulkImportSize(
  supabase: any,
  orgId: string,
  rowCount: number,
): Promise<EnforceResult> {
  const info = await getPlanByOrgId(supabase, orgId)
  if (!info) return planLookupFailed(orgId)   // fail closed

  if (isPlanBlocked(info.plan)) {
    return blockedError(planToTier(info.plan), 'bulk_import')
  }

  const tier = planToTier(info.plan)
  if (!isFeatureAllowed(tier, 'bulk_import')) {
    return {
      ok:     false,
      status: 403,
      error:  {
        error:        'tier_limit_exceeded',
        limit:        'feature_access',
        current_tier: tier,
        feature:      'bulk_import',
        upgrade_url:  '/pricing',
      },
    }
  }

  const max = TIER_LIMITS[tier].maxContacts
  if (!Number.isFinite(max)) return { ok: true }   // unlimited tier

  const current = await countActiveContacts(supabase, orgId)
  if (current === null) return { ok: true }

  if (current + rowCount > max) {
    return {
      ok:     false,
      status: 403,
      error:  {
        error:         'tier_limit_exceeded',
        limit:         'bulk_import_size',
        current_tier:  tier,
        current_count: current,
        tier_max:      max,
        upgrade_url:   '/pricing',
      },
    }
  }
  return { ok: true }
}

/**
 * Boolean feature gate. Used by routes that create or use a feature
 * which is wholly disabled at lower tiers (e.g. automation sequences,
 * multi-location).
 */
export async function checkFeatureAccess(
  supabase: any,
  orgId: string,
  feature: GatedFeature,
): Promise<EnforceResult> {
  const info = await getPlanByOrgId(supabase, orgId)
  if (!info) return planLookupFailed(orgId)   // fail closed

  if (isPlanBlocked(info.plan)) {
    return blockedError(planToTier(info.plan), feature)
  }

  const tier = planToTier(info.plan)
  if (!isFeatureAllowed(tier, feature)) {
    return {
      ok:     false,
      status: 403,
      error:  {
        error:        'tier_limit_exceeded',
        limit:        'feature_access',
        current_tier: tier,
        feature,
        upgrade_url:  '/pricing',
      },
    }
  }
  return { ok: true }
}
