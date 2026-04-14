import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { stripe, STRIPE_PLAN } from '@/lib/stripe'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('email, organization_id, organization:organizations(id, plan_status, stripe_customer_id, stripe_subscription_id)')
    .eq('id', user.id)
    .single()

  if (!profile?.organization_id) {
    return NextResponse.json({ error: 'No organization found' }, { status: 404 })
  }

  const org = profile.organization as any

  // Already active → should use portal, not start a new checkout
  if (org.stripe_subscription_id && org.plan_status === 'active') {
    return NextResponse.json({ error: 'Already subscribed — use Manage Billing to make changes.' }, { status: 409 })
  }

  const origin = new URL(req.url).origin

  // Monthly subscription is always included; setup fee is optional
  const lineItems: { price: string; quantity: number }[] = [
    { price: STRIPE_PLAN.monthly_price_id, quantity: 1 },
  ]
  if (STRIPE_PLAN.setup_fee_price_id) {
    lineItems.push({ price: STRIPE_PLAN.setup_fee_price_id, quantity: 1 })
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      // Reuse existing Stripe customer if available, otherwise prefill email
      ...(org.stripe_customer_id
        ? { customer: org.stripe_customer_id }
        : { customer_email: profile.email ?? undefined }),
      line_items: lineItems,
      // organization_id in metadata is what the webhook uses to find the org
      metadata: { organization_id: org.id },
      success_url: `${origin}/billing/return?success=true`,
      cancel_url:  `${origin}/billing/return?canceled=true`,
      allow_promotion_codes: true,
    })

    return NextResponse.json({ url: session.url })
  } catch (err: any) {
    console.error('[billing/checkout] Stripe error:', err.message)
    return NextResponse.json({ error: err.message ?? 'Failed to create checkout session' }, { status: 500 })
  }
}
