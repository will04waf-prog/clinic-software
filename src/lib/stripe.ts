import Stripe from 'stripe'

// Singleton Stripe client — server-side only.
// Never import this in client components.
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-03-25.dahlia',
})

// V1: one monthly plan + optional one-time setup fee
export const STRIPE_PLAN = {
  name: 'Tarhunna Pro',
  monthly_price_id:  process.env.STRIPE_MONTHLY_PRICE_ID!,
  setup_fee_price_id: process.env.STRIPE_SETUP_FEE_PRICE_ID ?? null,
  monthly_price_cents: 29700,   // $297/month
  setup_fee_cents:     50000,   // $500 one-time
} as const
