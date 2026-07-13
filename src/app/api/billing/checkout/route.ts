import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { stripe } from '@/lib/stripe'
import { priceIdForTier, type TierId, type BillingPeriod } from '@/lib/billing/tiers'
import { requireRole, isDenied, OWNER_ONLY } from '@/lib/auth/roles'

const VALID_TIERS:   readonly TierId[]        = ['starter', 'professional', 'scale']
const VALID_PERIODS: readonly BillingPeriod[] = ['monthly', 'annual']

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await requireRole(supabase, user.id, OWNER_ONLY)
  if (isDenied(gate)) return gate.response
  const orgId = gate.orgId

  const body = await req.json().catch(() => null) as { tier?: unknown; period?: unknown } | null
  const tier   = body?.tier
  const period = body?.period
  if (!VALID_TIERS.includes(tier as TierId) || !VALID_PERIODS.includes(period as BillingPeriod)) {
    return NextResponse.json({ error: 'Invalid tier or period' }, { status: 400 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('email')
    .eq('id', user.id)
    .single()

  const { data: org } = await supabase
    .from('organizations')
    .select('id, plan_status, stripe_customer_id, stripe_subscription_id')
    .eq('id', orgId)
    .single()

  if (!org) {
    return NextResponse.json({ error: 'No organization found' }, { status: 404 })
  }

  // Already active → a second checkout would create a SECOND
  // subscription. Instead, hand back a billing-portal session so the
  // pricing page's plan buttons become the upgrade/downgrade path.
  // Deep-link straight into the portal's plan picker when the portal
  // configuration allows it; fall back to the plain portal home if
  // switching isn't enabled in Stripe yet.
  if (org.stripe_subscription_id && org.plan_status === 'active') {
    if (!org.stripe_customer_id) {
      // Data inconsistency (subscription without customer) — surface
      // the old guidance rather than 500ing.
      return NextResponse.json({ error: 'Already subscribed — use Manage Billing to make changes.' }, { status: 409 })
    }
    const origin = new URL(req.url).origin
    try {
      const session = await stripe.billingPortal.sessions.create({
        customer:   org.stripe_customer_id,
        return_url: `${origin}/settings`,
        flow_data: {
          type: 'subscription_update',
          subscription_update: { subscription: org.stripe_subscription_id },
        },
      })
      return NextResponse.json({ url: session.url })
    } catch {
      const session = await stripe.billingPortal.sessions.create({
        customer:   org.stripe_customer_id,
        return_url: `${origin}/settings`,
      })
      return NextResponse.json({ url: session.url })
    }
  }

  const origin  = new URL(req.url).origin
  const priceId = priceIdForTier(tier as TierId, period as BillingPeriod)

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      ...(org.stripe_customer_id
        ? { customer: org.stripe_customer_id }
        : { customer_email: profile?.email ?? undefined }),
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
    return NextResponse.json({ error: 'Could not start checkout. Please try again.' }, { status: 500 })
  }
}
