/**
 * POST /api/webhooks/stripe-connect — events from CONNECTED accounts.
 *
 * The dispute-evidence rider. Under the direct-charge model, a client's
 * card dispute lands on the OWNER's connected account, and Stripe emits
 * `charge.dispute.created` to this Connect endpoint (event.account =
 * acct_...). We map payment_intent → payments ledger → invoice →
 * approved estimate, compose the approval record (timestamp + IP) into
 * dispute evidence, and attach it via the Stripe-Account header.
 *
 * ATTACH, not submit: AUTO_SUBMIT_EVIDENCE=false saves the evidence as a
 * draft on the dispute. Submitting is one-shot/irreversible, so the
 * default leaves a window to add photos/receipts before the due date;
 * flip the constant for zero-touch submission.
 *
 * Separate endpoint + secret from /api/webhooks/stripe: platform-account
 * events and connected-account events are distinct Stripe endpoints with
 * distinct signing secrets. Fail-closed when the secret is missing.
 *
 * Errors after signature verification return 500 so Stripe retries —
 * evidence attachment is idempotent (same values), so retries are safe.
 */
import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { stripe } from '@/lib/stripe'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { buildDisputeEvidence } from '@/lib/stripe/dispute-evidence'

const AUTO_SUBMIT_EVIDENCE = false

export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET
  if (!secret) {
    console.error('[stripe-connect-webhook] STRIPE_CONNECT_WEBHOOK_SECRET missing — failing closed.')
    return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  }

  const body = await req.text()
  const sig = req.headers.get('stripe-signature')
  if (!sig) {
    return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 })
  }

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, sig, secret)
  } catch (err: any) {
    console.error('[stripe-connect-webhook] Signature verification failed:', err.message)
    return NextResponse.json({ error: `Webhook error: ${err.message}` }, { status: 400 })
  }

  if (event.type !== 'charge.dispute.created') {
    return NextResponse.json({ received: true })
  }

  const connectedAccountId = event.account
  const dispute = event.data.object as Stripe.Dispute
  const paymentIntentId =
    typeof dispute.payment_intent === 'string'
      ? dispute.payment_intent
      : dispute.payment_intent?.id ?? null

  if (!connectedAccountId || !paymentIntentId) {
    console.error(`[stripe-connect-webhook] dispute ${dispute.id}: missing account or payment_intent — cannot map`)
    return NextResponse.json({ received: true })
  }

  try {
    // payment_intent → our ledger row → invoice + org.
    const { data: payment } = await supabaseAdmin
      .from('payments')
      .select('invoice_id, organization_id')
      .eq('stripe_payment_intent', paymentIntentId)
      .maybeSingle()
    if (!payment) {
      console.error(`[stripe-connect-webhook] dispute ${dispute.id}: no ledger row for intent ${paymentIntentId}`)
      return NextResponse.json({ received: true })
    }

    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('name, stripe_connect_id')
      .eq('id', payment.organization_id)
      .single()
    if (!org || org.stripe_connect_id !== connectedAccountId) {
      console.error(`[stripe-connect-webhook] dispute ${dispute.id}: account mismatch (event ${connectedAccountId})`)
      return NextResponse.json({ received: true })
    }

    const { data: invoice } = await supabaseAdmin
      .from('invoices')
      .select('invoice_number, title, total_cents, estimate_id, job_id, contact:contacts(first_name, last_name, email, phone)')
      .eq('id', payment.invoice_id)
      .single()
    if (!invoice) {
      console.error(`[stripe-connect-webhook] dispute ${dispute.id}: invoice ${payment.invoice_id} not found`)
      return NextResponse.json({ received: true })
    }

    // The approval record, when the invoice came from an approved estimate.
    let estimate: { estimate_number: number; approved_at: string | null; approved_ip: string | null } | null = null
    if (invoice.estimate_id) {
      const { data } = await supabaseAdmin
        .from('estimates')
        .select('estimate_number, approved_at, approved_ip')
        .eq('id', invoice.estimate_id)
        .maybeSingle()
      estimate = data ?? null
    }

    let serviceDate: string | null = null
    if (invoice.job_id) {
      const { data: job } = await supabaseAdmin
        .from('jobs')
        .select('scheduled_date')
        .eq('id', invoice.job_id)
        .maybeSingle()
      serviceDate = job?.scheduled_date ?? null
    }

    const contact = (Array.isArray(invoice.contact) ? invoice.contact[0] : invoice.contact) as
      | { first_name?: string; last_name?: string; email?: string; phone?: string }
      | null

    const evidence = buildDisputeEvidence({
      businessName: org.name || 'Tarhunna',
      customerName: [contact?.first_name, contact?.last_name].filter(Boolean).join(' ') || null,
      customerEmail: contact?.email ?? null,
      customerPhone: contact?.phone ?? null,
      invoiceNumber: invoice.invoice_number,
      invoiceTitle: invoice.title,
      totalCents: invoice.total_cents ?? 0,
      estimateNumber: estimate?.estimate_number ?? null,
      approvedAt: estimate?.approved_at ?? null,
      approvedIp: estimate?.approved_ip ?? null,
      serviceDate,
    })

    await stripe.disputes.update(
      dispute.id,
      { evidence, submit: AUTO_SUBMIT_EVIDENCE },
      { stripeAccount: connectedAccountId },
    )

    const dueBy = dispute.evidence_details?.due_by
      ? new Date(dispute.evidence_details.due_by * 1000).toISOString()
      : 'unknown'
    console.log(
      `[stripe-connect-webhook] dispute ${dispute.id}: approval evidence attached ` +
      `(submit=${AUTO_SUBMIT_EVIDENCE}, due ${dueBy}, invoice #${invoice.invoice_number}, ` +
      `approval=${estimate?.approved_at ? 'yes' : 'none'})`,
    )
    return NextResponse.json({ received: true })
  } catch (err: any) {
    // 500 → Stripe retries; the evidence update is idempotent.
    console.error(`[stripe-connect-webhook] dispute ${dispute.id}: evidence attach failed:`, err?.message)
    return NextResponse.json({ error: 'Evidence attach failed' }, { status: 500 })
  }
}
