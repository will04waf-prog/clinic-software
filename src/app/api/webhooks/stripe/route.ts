import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { stripe } from '@/lib/stripe'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { tierFromPriceId } from '@/lib/billing/tiers'

// Map Stripe subscription statuses → Tarhunna plan_status values
const STRIPE_STATUS_MAP: Record<string, string> = {
  active:             'active',
  trialing:           'trial',
  past_due:           'past_due',
  incomplete:         'past_due',
  canceled:           'canceled',
  incomplete_expired: 'canceled',
  paused:             'suspended',
  unpaid:             'suspended',
}

async function updateOrgBySubscription(subId: string, fields: Record<string, unknown>) {
  const { error } = await supabaseAdmin
    .from('organizations')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('stripe_subscription_id', subId)

  if (error) {
    console.error(`[stripe-webhook] DB update failed for sub ${subId}:`, error.message)
  }
}

export async function POST(req: NextRequest) {
  const body = await req.text()
  const sig  = req.headers.get('stripe-signature')

  if (!sig) {
    return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 })
  }

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch (err: any) {
    console.error('[stripe-webhook] Signature verification failed:', err.message)
    return NextResponse.json({ error: `Webhook error: ${err.message}` }, { status: 400 })
  }

  try {
    switch (event.type) {

      // ── Subscription created via Checkout ────────────────────────
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        if (session.mode !== 'subscription') break

        const orgId = session.metadata?.organization_id
        if (!orgId) {
          console.error('[stripe-webhook] checkout.session.completed: missing organization_id in metadata')
          break
        }

        const customerId     = typeof session.customer     === 'string' ? session.customer     : session.customer?.id
        const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id

        if (!customerId || !subscriptionId) {
          console.error('[stripe-webhook] checkout.session.completed: missing customer or subscription id')
          break
        }

        // Derive tier from the subscription's price. If the price doesn't map
        // to a known tier (e.g., manual subscription created via Stripe
        // dashboard), don't overwrite the plan column — leave whatever was
        // there and log so we can investigate.
        const sub     = await stripe.subscriptions.retrieve(subscriptionId)
        const priceId = sub.items.data[0]?.price.id ?? null
        const tier    = priceId ? tierFromPriceId(priceId) : null

        const update: Record<string, unknown> = {
          stripe_customer_id:     customerId,
          stripe_subscription_id: subscriptionId,
          plan_status:            'active',
          updated_at:             new Date().toISOString(),
        }
        if (tier) {
          update.plan = tier
        } else {
          console.error(`[stripe-webhook] checkout.session.completed: unknown price ${priceId} on sub ${subscriptionId} — leaving plan column unchanged`)
        }

        const { error } = await supabaseAdmin
          .from('organizations')
          .update(update)
          .eq('id', orgId)

        if (error) {
          console.error('[stripe-webhook] checkout.session.completed DB update failed:', error.message)
        }
        break
      }

      // ── Payment succeeded → ensure active ────────────────────────
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as any
        const subId   = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id
        if (!subId) break

        await updateOrgBySubscription(subId, { plan_status: 'active' })
        break
      }

      // ── Payment failed → mark past_due ────────────────────────────
      case 'invoice.payment_failed': {
        const invoice = event.data.object as any
        const subId   = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id
        if (!subId) break

        await updateOrgBySubscription(subId, { plan_status: 'past_due' })
        break
      }

      // ── Subscription status changed ───────────────────────────────
      case 'customer.subscription.updated': {
        const sub        = event.data.object as Stripe.Subscription
        const planStatus = STRIPE_STATUS_MAP[sub.status] ?? 'past_due'

        // Re-derive tier in case the customer changed plans (upgrade/downgrade
        // via Stripe portal). If the price is unknown, only update plan_status.
        const priceId = sub.items.data[0]?.price.id ?? null
        const tier    = priceId ? tierFromPriceId(priceId) : null

        const update: Record<string, unknown> = { plan_status: planStatus }
        if (tier) {
          update.plan = tier
        } else if (priceId) {
          console.error(`[stripe-webhook] customer.subscription.updated: unknown price ${priceId} on sub ${sub.id} — leaving plan column unchanged`)
        }

        await updateOrgBySubscription(sub.id, update)
        break
      }

      // ── Subscription canceled / deleted ───────────────────────────
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription
        await updateOrgBySubscription(sub.id, { plan_status: 'canceled' })
        break
      }

      default:
        // Unhandled event type — not an error, just ignore
        break
    }
  } catch (err: any) {
    // Return 200 so Stripe doesn't retry — we log the error for investigation
    console.error('[stripe-webhook] Handler error:', err.message)
  }

  return NextResponse.json({ received: true })
}
