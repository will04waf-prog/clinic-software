import { NextRequest, NextResponse } from 'next/server'
import { after } from 'next/server'
import Stripe from 'stripe'
import { stripe, isCrmPrice } from '@/lib/stripe'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { tierFromPriceId } from '@/lib/billing/tiers'
import { sendPaymentFailedEmail, sendSubscriptionCanceledEmail } from '@/lib/billing-lifecycle-emails'

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
        // CRM $39/mo plan isn't a med-spa tier — map it to the generic
        // paid marker 'pro' so plan reflects "subscribed".
        const planValue = tier ?? (isCrmPrice(priceId) ? 'pro' : null)

        const update: Record<string, unknown> = {
          stripe_customer_id:     customerId,
          stripe_subscription_id: subscriptionId,
          plan_status:            'active',
          // Fresh subscription = clean churn slate: if they cancel
          // again later, the win-back sweep can fire again.
          canceled_at:            null,
          winback_sent_at:        null,
          updated_at:             new Date().toISOString(),
        }
        if (planValue) {
          update.plan = planValue
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

      // ── Payment failed → mark past_due + dunning email ───────────
      case 'invoice.payment_failed': {
        const invoice = event.data.object as any
        const subId   = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id
        if (!subId) break

        await updateOrgBySubscription(subId, { plan_status: 'past_due' })
        // One email per real retry attempt (idempotency embeds
        // invoice id + attempt). after(): Stripe gets its 200 before
        // the Resend HTTP call runs — a slow email must never push
        // this handler past Stripe's delivery timeout (redelivery
        // would re-run the whole event switch).
        after(() => sendPaymentFailedEmail(subId, {
          id: String(invoice.id ?? 'unknown'),
          attempt: Number(invoice.attempt_count ?? 1),
        }))
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
        // Stripe-managed trials: when 'trialing' maps to plan_status
        // 'trial', trial_ends_at must track the SUBSCRIPTION's trial end.
        // Otherwise the org keeps its signup-era trial_ends_at (long
        // past) and blockedReason()/expire-trials would treat a live
        // subscriber as trial_expired — locking them out and silencing
        // their reminder/automation sends.
        if (planStatus === 'trial' && sub.trial_end) {
          update.trial_ends_at = new Date(sub.trial_end * 1000).toISOString()
        }
        if (tier) {
          update.plan = tier
          // Tier-gating safety: any downgrade from Scale to a lower
          // tier must FORCE autonomous send off in the DB. The
          // runtime gate in auto-send.ts already refuses, but
          // leaving ai_twin_auto_send_enabled=true is misleading in
          // the Settings UI and costs a Claude call per inbound.
          // Reset rollout to 100% and shadow to false too so re-
          // upgrading is a clean slate the owner must explicitly
          // opt into.
          if (tier !== 'scale') {
            update.ai_twin_auto_send_enabled = false
            update.ai_twin_auto_send_rollout_pct = 100
            update.ai_twin_auto_send_shadow_mode = false
          }
        } else if (isCrmPrice(priceId)) {
          // CRM $39/mo plan → generic paid marker.
          update.plan = 'pro'
        } else if (priceId) {
          console.error(`[stripe-webhook] customer.subscription.updated: unknown price ${priceId} on sub ${sub.id} — leaving plan column unchanged`)
        }

        await updateOrgBySubscription(sub.id, update)
        break
      }

      // ── Subscription canceled / deleted ───────────────────────────
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription
        await updateOrgBySubscription(sub.id, {
          plan_status: 'canceled',
          // canceled_at anchors the 14-day churn win-back sweep.
          canceled_at: new Date().toISOString(),
          // Cancellation forces autonomous send off — the org loses
          // access at the proxy layer, but we don't want a stale
          // "enabled" toggle waiting if they re-subscribe later.
          ai_twin_auto_send_enabled: false,
          ai_twin_auto_send_rollout_pct: 100,
          ai_twin_auto_send_shadow_mode: false,
        })
        // Immediate "subscription ended" email (data-is-safe framing +
        // resubscribe CTA). after() for the same timeout reason.
        after(() => sendSubscriptionCanceledEmail(sub.id))
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
