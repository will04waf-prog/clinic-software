import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { stripe } from '@/lib/stripe'
import { priceIdForTier, type TierId, type BillingPeriod } from '@/lib/billing/tiers'

const VALID_TIERS:   readonly TierId[]        = ['starter', 'professional', 'scale']
const VALID_PERIODS: readonly BillingPeriod[] = ['monthly', 'annual']

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null) as { tier?: unknown; period?: unknown } | null
  const tier   = body?.tier
  const period = body?.period
  if (!VALID_TIERS.includes(tier as TierId) || !VALID_PERIODS.includes(period as BillingPeriod)) {
    return NextResponse.json({ error: 'Invalid tier or period' }, { status: 400 })
  }

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

  const origin  = new URL(req.url).origin
  const priceId = priceIdForTier(tier as TierId, period as BillingPeriod)

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      ...(org.stripe_customer_id
        ? { customer: org.stripe_customer_id }
        : { customer_email: profile.email ?? undefined }),
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: {
        organization_id: org.id,
        tier:   tier as string,
        period: period as string,
      },
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
