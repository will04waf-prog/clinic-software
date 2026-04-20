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
