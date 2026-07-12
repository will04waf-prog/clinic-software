/**
 * The money constants for the CRM-pivot payment rails. Pure + import-safe
 * from anywhere (no Stripe SDK, no env at import time) so it can be unit-
 * tested and referenced from client bundles.
 *
 * TWO distinct fees — don't conflate them:
 *
 *  1. CLIENT card payment (Stripe Connect, DIRECT charge on the owner's
 *     connected account): the owner is the merchant of record and pays
 *     Stripe's standard processing (~2.9% + 30¢) directly. On top of that
 *     we take a 1% `application_fee_amount` — our platform revenue. The
 *     owner's ALL-IN cost is therefore 2.9%+30¢ (Stripe) + 1% (us) =
 *     ≈ 3.9% + 30¢, which is exactly the single rate we show them.
 *     Cash / Zelle / check recording is always free (no Stripe, no fee).
 *
 *  2. SaaS SUBSCRIPTION: one plan, $39/mo, 14-day free trial, no card
 *     required to start (the app-level trial engine owns that), card
 *     collected when they subscribe at/near trial end.
 *
 * Founder-locked 2026-07-12. Change these numbers here and nowhere else.
 */

/** Our cut of a client card payment, in basis points (1% = 100 bps). */
export const PLATFORM_FEE_BPS = 100 as const

/** The all-in card rate we DISPLAY to owners (Stripe ~2.9%+30¢ + our 1%). */
export const OWNER_CARD_RATE_DISPLAY = '3.9% + 30¢' as const

/** The single SaaS plan. */
export const CRM_PLAN = {
  name: 'Tarhunna',
  monthlyPriceCents: 3900, // $39/mo
  trialDays: 14,
} as const

/**
 * Our application fee on a client card payment of `totalCents`, in cents.
 * 1% of the total, rounded to the nearest cent, never negative. This is
 * the `application_fee_amount` on the direct charge — Stripe's processing
 * fee is separate and paid by the connected account, not double-counted
 * here.
 */
export function applicationFeeCents(totalCents: number): number {
  if (!Number.isFinite(totalCents) || totalCents <= 0) return 0
  return Math.round((totalCents * PLATFORM_FEE_BPS) / 10_000)
}
