/**
 * POST /api/billing/subscribe — CRM-pivot SaaS: the single $39/mo plan.
 *
 * Owner-only. The 14-day free trial with NO card up front is owned by the
 * app-level trial engine (set at signup); this route is the "collect card
 * at trial end" step. If the owner subscribes while their app trial is
 * still running, we pass that remaining time to Stripe as `trial_end` so
 * the card is saved now but the first charge lands when the trial would
 * have ended — subscribing early never costs them trial days.
 *
 * Already subscribed → hand back a billing-portal session instead of
 * creating a second subscription.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { stripe, crmPriceId } from '@/lib/stripe'
import { requireRole, isDenied, OWNER_ONLY } from '@/lib/auth/roles'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await requireRole(supabase, user.id, OWNER_ONLY)
  if (isDenied(gate)) return gate.response
  const orgId = gate.orgId

  const { data: profile } = await supabase.from('profiles').select('email').eq('id', user.id).single()

  const { data: org } = await supabase
    .from('organizations')
    .select('id, plan_status, trial_ends_at, stripe_customer_id, stripe_subscription_id')
    .eq('id', orgId)
    .single()
  if (!org) return NextResponse.json({ error: 'No organization found' }, { status: 404 })

  const origin = new URL(req.url).origin

  // Already subscribed → billing portal (never a second subscription).
  if (org.stripe_subscription_id && org.plan_status === 'active') {
    if (!org.stripe_customer_id) {
      return NextResponse.json({ error: 'Already subscribed — use Manage Billing.' }, { status: 409 })
    }
    const session = await stripe.billingPortal.sessions.create({
      customer: org.stripe_customer_id,
      return_url: `${origin}/settings`,
    })
    return NextResponse.json({ url: session.url })
  }

  // Honor remaining app-trial: card saved now, first charge at trial end.
  const trialEndsMs = org.trial_ends_at ? new Date(org.trial_ends_at).getTime() : 0
  const nowMs = Date.now()
  const trialEndUnix = trialEndsMs > nowMs ? Math.floor(trialEndsMs / 1000) : undefined

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      ...(org.stripe_customer_id
        ? { customer: org.stripe_customer_id }
        : { customer_email: profile?.email ?? undefined }),
      line_items: [{ price: crmPriceId(), quantity: 1 }],
      subscription_data: trialEndUnix ? { trial_end: trialEndUnix } : undefined,
      metadata: { organization_id: org.id, plan: 'crm' },
      success_url: `${origin}/billing/return?success=true`,
      cancel_url: `${origin}/settings?sub=canceled`,
      allow_promotion_codes: true,
    })
    return NextResponse.json({ url: session.url })
  } catch (err: any) {
    // Same policy as connect/onboard: raw Stripe text never reaches an
    // owner — log here, return a stable code the card localizes.
    console.error('[billing/subscribe] Stripe error:', err?.message)
    return NextResponse.json({ error: 'checkout_not_ready' }, { status: 503 })
  }
}
