import Stripe from 'stripe'

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-03-25.dahlia',
})

export const PLANS = {
  starter: {
    name: 'Starter',
    price_id: process.env.STRIPE_STARTER_PRICE_ID!,
    price: 297,
    description: 'Up to 2 users, 500 contacts',
    features: [
      'Lead capture forms',
      'CRM & pipeline',
      'Email automations',
      '500 SMS/month',
      '2 staff users',
    ],
  },
  pro: {
    name: 'Pro',
    price_id: process.env.STRIPE_PRO_PRICE_ID!,
    price: 497,
    description: 'Unlimited users, unlimited contacts',
    features: [
      'Everything in Starter',
      'Unlimited contacts',
      'Unlimited staff users',
      '2,000 SMS/month',
      'Custom automations',
      'Priority support',
    ],
  },
} as const

export async function createCheckoutSession(
  orgId: string,
  priceId: string,
  customerId?: string
) {
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    metadata: { organization_id: orgId },
    success_url: `${process.env.NEXT_PUBLIC_APP_URL}/settings?upgrade=success`,
    cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/settings?upgrade=canceled`,
    allow_promotion_codes: true,
  })

  return session
}

export async function createBillingPortalSession(customerId: string) {
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${process.env.NEXT_PUBLIC_APP_URL}/settings`,
  })
  return session
}
