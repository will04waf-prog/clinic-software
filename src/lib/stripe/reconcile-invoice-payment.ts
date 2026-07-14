/**
 * Record a completed card payment against an invoice — idempotently.
 *
 * Called when a client returns from Stripe-hosted Checkout with a
 * session_id. We retrieve the session ON the connected account (direct
 * charge), and only if it's actually `paid` do we append a 'card' row to
 * the append-only payments ledger, recompute amount_paid, and flip the
 * invoice to 'paid' once covered.
 *
 * Idempotency is layered: a pre-check on the payment_intent, plus the
 * DB's partial-unique index on (invoice_id, stripe_payment_intent) as the
 * race backstop — a duplicate insert is swallowed and treated as
 * already-recorded. Safe to call on every page load of the success URL.
 */
import { stripe } from '@/lib/stripe'
import type { TablesUpdate } from '@/types/database'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { applicationFeeCents } from '@/lib/billing/connect-fees'

export interface ReconcileResult {
  /** true once the invoice is fully paid (whether we recorded now or before). */
  paid: boolean
  /** true if THIS call is the one that recorded the payment. */
  recorded: boolean
}

// Postgres unique-violation.
const UNIQUE_VIOLATION = '23505'

export async function reconcileInvoicePayment(params: {
  invoiceId: string
  organizationId: string
  connectedAccountId: string
  sessionId: string
}): Promise<ReconcileResult> {
  const { invoiceId, organizationId, connectedAccountId, sessionId } = params

  const session = await stripe.checkout.sessions.retrieve(sessionId, undefined, {
    stripeAccount: connectedAccountId,
  })
  if (session.payment_status !== 'paid') {
    return { paid: false, recorded: false }
  }

  const paymentIntentId =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id ?? null
  const amount = session.amount_total ?? 0

  // Pre-check: already recorded this intent?
  if (paymentIntentId) {
    const { data: existing } = await supabaseAdmin
      .from('payments')
      .select('id')
      .eq('invoice_id', invoiceId)
      .eq('stripe_payment_intent', paymentIntentId)
      .maybeSingle()
    if (existing) {
      await settleInvoice(invoiceId, organizationId)
      return { paid: true, recorded: false }
    }
  }

  const { error: insErr } = await supabaseAdmin.from('payments').insert({
    organization_id: organizationId,
    invoice_id: invoiceId,
    amount_cents: amount,
    method: 'card',
    status: 'succeeded',
    stripe_payment_intent: paymentIntentId,
    application_fee_cents: applicationFeeCents(amount),
  })
  if (insErr && insErr.code !== UNIQUE_VIOLATION) {
    throw new Error(`reconcileInvoicePayment: ledger insert failed: ${insErr.message}`)
  }

  await settleInvoice(invoiceId, organizationId)
  // If it was a unique violation, a concurrent call recorded it first.
  return { paid: true, recorded: !insErr }
}

/** Recompute amount_paid from succeeded rows and flip to paid if covered. */
async function settleInvoice(invoiceId: string, organizationId: string): Promise<void> {
  const { data: invoice } = await supabaseAdmin
    .from('invoices')
    .select('total_cents, status')
    .eq('id', invoiceId)
    .eq('organization_id', organizationId)
    .single()
  if (!invoice) return

  const { data: succeeded } = await supabaseAdmin
    .from('payments')
    .select('amount_cents')
    .eq('invoice_id', invoiceId)
    .eq('organization_id', organizationId)
    .eq('status', 'succeeded')

  const amountPaid = (succeeded ?? []).reduce((sum, p: any) => sum + (p.amount_cents ?? 0), 0)
  const nowPaid = amountPaid >= (invoice.total_cents ?? 0)

  const update: Record<string, unknown> = { amount_paid_cents: amountPaid }
  if (nowPaid && invoice.status !== 'paid') {
    update.status = 'paid'
    update.paid_at = new Date().toISOString()
  }
  await supabaseAdmin
    .from('invoices')
    .update(update as TablesUpdate<'invoices'>)
    .eq('id', invoiceId)
    .eq('organization_id', organizationId)
}
