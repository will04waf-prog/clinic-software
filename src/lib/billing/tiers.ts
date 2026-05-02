// Single source of truth for tier behavior. All billing UI, checkout,
// webhook handlers, and enforcement code import from here.

export type TierId = 'starter' | 'professional' | 'scale'
export type BillingPeriod = 'monthly' | 'annual'

export interface TierLimits {
  maxContacts: number              // Number.POSITIVE_INFINITY for unlimited
  allowsAutomationSequences: boolean   // sequence engine for follow-up campaigns
  allowsAutomatedReminders:  boolean   // cron-driven 24h/2h consultation reminders
  allowsBulkImport:          boolean
  allowsMultiLocation:       boolean
  smsCreditsPerMonth:        number
}

export interface TierPricing {
  monthlyCents: number
  annualCents:  number             // displayed per-month price when billed annually (20% off)
}

export const TIER_DISPLAY_NAMES: Record<TierId, string> = {
  starter:      'Starter',
  professional: 'Professional',
  scale:        'Scale',
}

export const TIER_LIMITS: Record<TierId, TierLimits> = {
  starter: {
    maxContacts:               500,
    allowsAutomationSequences: false,
    allowsAutomatedReminders:  false,
    allowsBulkImport:          false,
    allowsMultiLocation:       false,
    smsCreditsPerMonth:        500,
  },
  professional: {
    maxContacts:               2500,
    allowsAutomationSequences: true,
    allowsAutomatedReminders:  true,
    allowsBulkImport:          true,
    allowsMultiLocation:       false,
    smsCreditsPerMonth:        2000,
  },
  scale: {
    maxContacts:               Number.POSITIVE_INFINITY,
    allowsAutomationSequences: true,
    allowsAutomatedReminders:  true,
    allowsBulkImport:          true,
    allowsMultiLocation:       true,
    smsCreditsPerMonth:        5000,
  },
}

export const TIER_PRICING: Record<TierId, TierPricing> = {
  starter:      { monthlyCents: 14700, annualCents: 11760 },  // $147 / $117.60
  professional: { monthlyCents: 29700, annualCents: 23760 },  // $297 / $237.60
  scale:        { monthlyCents: 49700, annualCents: 39760 },  // $497 / $397.60
}

// Lazy-initialized maps. Built on first call to priceIdForTier or
// tierFromPriceId — keeps the module importable from client bundles
// (which don't see STRIPE_PRICE_* env vars) without throwing at import time.
let _priceIds:    Record<string, string> | null = null
let _priceToTier: Record<string, TierId> | null = null

function ensureMaps(): { priceIds: Record<string, string>; priceToTier: Record<string, TierId> } {
  if (_priceIds && _priceToTier) return { priceIds: _priceIds, priceToTier: _priceToTier }

  const TIER_PERIODS = [
    ['starter',      'monthly'] as const,
    ['starter',      'annual']  as const,
    ['professional', 'monthly'] as const,
    ['professional', 'annual']  as const,
    ['scale',        'monthly'] as const,
    ['scale',        'annual']  as const,
  ]

  const priceIds:    Record<string, string> = {}
  const priceToTier: Record<string, TierId> = {}

  for (const [tier, period] of TIER_PERIODS) {
    const key = `STRIPE_PRICE_${tier.toUpperCase()}_${period.toUpperCase()}`
    const value = process.env[key]
    if (!value) {
      throw new Error(
        `Missing required env var: ${key}. ` +
        `All 6 STRIPE_PRICE_* env vars must be set for billing to function.`,
      )
    }
    priceIds[`${tier}:${period}`] = value
    priceToTier[value] = tier
  }

  _priceIds = priceIds
  _priceToTier = priceToTier
  return { priceIds, priceToTier }
}

/**
 * Returns the Stripe Price ID for a tier+period. Server-side only.
 * Throws on first call if any of the 6 STRIPE_PRICE_* env vars are missing —
 * fail loudly at checkout rather than silently create broken Stripe sessions.
 */
export function priceIdForTier(tier: TierId, period: BillingPeriod): string {
  const { priceIds } = ensureMaps()
  return priceIds[`${tier}:${period}`]
}

/**
 * Reverse map: derive tier from a Stripe Price ID (used by webhook handler).
 * Returns null if the Price ID is unrecognized — caller should log and skip
 * rather than crash, so an unknown price doesn't take down webhook delivery.
 */
export function tierFromPriceId(priceId: string): TierId | null {
  const { priceToTier } = ensureMaps()
  return priceToTier[priceId] ?? null
}
