/**
 * POST /api/pay/[token]/checkout — CRM-pivot LOOP, public (no auth).
 *
 * The client tapped "Pagar con tarjeta" on /pagar/[token]. We verify the
 * capability token, load the invoice + the owner's connected account via
 * service-role (never anon), and open a Stripe-hosted Checkout Session as
 * a DIRECT charge on the owner's connected account with our 1%
 * application fee. Card data never touches our page.
 *
 * Guards: token must verify for purpose 'invoice_pay'; invoice must be
 * unpaid and not void; the org must have Connect charges enabled.
 */
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { verifyCapabilityToken } from '@/lib/tokens/capability-token'
import { stripe } from '@/lib/stripe'
import { applicationFeeCents } from '@/lib/billing/connect-fees'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  const invoiceId = verifyCapabilityToken('invoice_pay', token)
  if (!invoiceId) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const { data: invoice } = await supabaseAdmin
    .from('invoices')
    .select('id, organization_id, invoice_number, title, status, total_cents, amount_paid_cents, currency')
    .eq('id', invoiceId)
    .maybeSingle()
  if (!invoice) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const balance = Math.max(0, (invoice.total_cents ?? 0) - (invoice.amount_paid_cents ?? 0))
  if (invoice.status === 'void') {
    return NextResponse.json({ error: 'not_available' }, { status: 409 })
  }
  if (invoice.status === 'paid' || balance <= 0) {
    return NextResponse.json({ error: 'already_paid' }, { status: 409 })
  }

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('name, stripe_connect_id, connect_charges_enabled')
    .eq('id', invoice.organization_id)
    .single()
  if (!org?.stripe_connect_id || !org.connect_charges_enabled) {
    return NextResponse.json({ error: 'not_available' }, { status: 409 })
  }

  const origin = new URL(req.url).origin
  const currency = invoice.currency || 'usd'

  try {
    const session = await stripe.checkout.sessions.create(
      {
        mode: 'payment',
        payment_method_types: ['card'],
        line_items: [
          {
            price_data: {
              currency,
              product_data: {
                name: invoice.title || `Factura #${invoice.invoice_number}`,
              },
              unit_amount: balance,
            },
            quantity: 1,
          },
        ],
        payment_intent_data: {
          // Our 1% cut. Stripe's processing (~2.9%+30¢) is paid by the
          // connected account, so the owner's all-in is ≈ 3.9% + 30¢.
          application_fee_amount: applicationFeeCents(balance),
        },
        success_url: `${origin}/pagar/${token}?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/pagar/${token}`,
        metadata: {
          invoice_id: invoice.id,
          organization_id: invoice.organization_id,
        },
      },
      { stripeAccount: org.stripe_connect_id },
    )

    return NextResponse.json({ url: session.url })
  } catch (err: any) {
    console.error('[pay/checkout] Stripe error:', err?.message)
    return NextResponse.json({ error: 'stripe_error' }, { status: 502 })
  }
}
