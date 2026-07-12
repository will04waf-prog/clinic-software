import Stripe from 'stripe'

// Singleton Stripe client — server-side only.
// Never import this in client components.
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-03-25.dahlia',
})

// V1: one monthly plan
export const STRIPE_PLAN = {
  name: 'Tarhunna Pro',
  monthly_price_cents: 29700,   // $297/month
} as const

/**
 * CRM-pivot SaaS plan: the single $39/mo Price. Created via the Stripe
 * API and stored in STRIPE_PRICE_CRM_MONTHLY. Read lazily (not at import)
 * so client bundles that never call it don't need the env var.
 */
export function crmPriceId(): string {
  const id = process.env.STRIPE_PRICE_CRM_MONTHLY
  if (!id) throw new Error('Missing STRIPE_PRICE_CRM_MONTHLY — the $39/mo Price is not configured.')
  return id
}

/** True if a Stripe price id is the CRM $39/mo plan (webhook plan mapping). */
export function isCrmPrice(priceId: string | null | undefined): boolean {
  return !!priceId && priceId === process.env.STRIPE_PRICE_CRM_MONTHLY
}
