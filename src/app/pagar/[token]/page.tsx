/**
 * /pagar/[token] — CRM-pivot LOOP. PUBLIC client-facing CARD PAYMENT page.
 *
 * Mirrors /aprobar: Spanish-first, mobile-first, no login. Reads the
 * invoice via SERVICE-ROLE (never anon) gated by an HMAC capability token
 * bound to purpose 'invoice_pay'. proxy.ts allowlists /pagar.
 *
 * When Stripe redirects back with ?session_id=..., we reconcile the
 * payment (idempotent) before rendering the paid state — so the ledger is
 * authoritative even without a configured Connect webhook.
 */
import type { Metadata } from 'next'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { verifyCapabilityToken } from '@/lib/tokens/capability-token'
import { resolveLocale } from '@/lib/i18n'
import { reconcileInvoicePayment } from '@/lib/stripe/reconcile-invoice-payment'
import { getJobPhotoUrls } from '@/lib/loop/job-photo-urls'
import { PayView, PayStatus } from './pay-view'

// Dynamic title/OG: the WhatsApp preview should say WHOSE invoice this
// is — a homeowner about to enter a card needs the business's name in
// the chat bubble, not a bare link. Still no-index (capability token).
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params
  const fallback: Metadata = { title: 'Factura', robots: { index: false, follow: false } }
  const invoiceId = verifyCapabilityToken('invoice_pay', token)
  if (!invoiceId) return fallback
  const { data } = await supabaseAdmin
    .from('invoices')
    .select('organization_id, organizations(name)')
    .eq('id', invoiceId)
    .maybeSingle()
  const org = (data?.organizations ?? null) as { name?: string } | null
  if (!org?.name) return fallback
  const title = `Factura de ${org.name}`
  return {
    title,
    description: 'Revise su factura y pague de forma segura.',
    robots: { index: false, follow: false },
    openGraph: { title, description: 'Revise su factura y pague de forma segura.', siteName: org.name },
  }
}

export default async function PayPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ session_id?: string }>
}) {
  const { token } = await params
  const { session_id } = await searchParams

  const invoiceId = verifyCapabilityToken('invoice_pay', token)
  if (!invoiceId) return <PayStatus kind="notFound" locale="es" />

  const { data: invoice } = await supabaseAdmin
    .from('invoices')
    .select(`
      id, organization_id, invoice_number, title, status, total_cents,
      amount_paid_cents, job_id, created_at, notes,
      line_items:invoice_line_items(id, description, quantity, unit_price_cents, position),
      estimate:estimates(approved_at),
      contact:contacts(first_name, preferred_language)
    `)
    .eq('id', invoiceId)
    .maybeSingle()
  if (!invoice) return <PayStatus kind="notFound" locale="es" />

  // Completion photos from the job this invoice bills — proof of work the
  // paying client sees, and (once live) dispute evidence.
  const photoUrls = await getJobPhotoUrls(invoice.job_id)

  // Approval record from the estimate this invoice descends from — the
  // dispute shield, shown on the page a client (and their bank) sees.
  const estimate = Array.isArray(invoice.estimate) ? invoice.estimate[0] : invoice.estimate
  const approvedAt = (estimate as { approved_at?: string | null } | null)?.approved_at ?? null

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('name, phone, owner_language, stripe_connect_id, connect_charges_enabled')
    .eq('id', invoice.organization_id)
    .single()

  const contact = Array.isArray(invoice.contact) ? invoice.contact[0] : invoice.contact
  const locale = resolveLocale(contact?.preferred_language ?? org?.owner_language)
  const businessName = org?.name || 'Tarhunna'

  // Returned from Stripe Checkout → reconcile before deciding what to show.
  // ONLY show the paid confirmation when reconcile actually confirms the
  // payment succeeded. If it throws, or the Checkout session isn't 'paid'
  // (card declined, tab reopened on a stale session), fall through to
  // re-read the invoice and show its true state — never a false "paid".
  if (session_id && org?.stripe_connect_id) {
    try {
      const result = await reconcileInvoicePayment({
        invoiceId: invoice.id,
        organizationId: invoice.organization_id,
        connectedAccountId: org.stripe_connect_id,
        sessionId: session_id,
      })
      if (result.paid) {
        return <PayStatus kind="paid" locale={locale} businessName={businessName} />
      }
    } catch (err) {
      console.error('[pagar] reconcile failed:', err instanceof Error ? err.message : err)
    }
  }

  // Re-read status after any reconcile (fresh row).
  const { data: fresh } = await supabaseAdmin
    .from('invoices')
    .select('status, total_cents, amount_paid_cents')
    .eq('id', invoice.id)
    .single()

  const status = fresh?.status ?? invoice.status
  const total = fresh?.total_cents ?? invoice.total_cents ?? 0
  const paid = fresh?.amount_paid_cents ?? invoice.amount_paid_cents ?? 0
  const balance = Math.max(0, total - paid)

  if (status === 'void') return <PayStatus kind="notAvailable" locale={locale} />
  if (status === 'paid' || balance <= 0) {
    return <PayStatus kind="alreadyPaid" locale={locale} businessName={businessName} />
  }
  if (!org?.stripe_connect_id || !org.connect_charges_enabled) {
    return <PayStatus kind="notAvailable" locale={locale} />
  }

  const lineItems = [...(invoice.line_items ?? [])]
    .sort((a: { position: number | null }, b: { position: number | null }) => (a.position ?? 0) - (b.position ?? 0))
    .map((li: { id: string; description: string; quantity: number | string; unit_price_cents: number }) => ({
      id: li.id,
      description: li.description,
      quantity: Number(li.quantity),
      unitPriceCents: li.unit_price_cents,
    }))

  return (
    <PayView
      token={token}
      locale={locale}
      businessName={businessName}
      businessPhone={org?.phone ?? null}
      invoiceNumber={invoice.invoice_number}
      createdAt={invoice.created_at ?? null}
      notes={invoice.notes ?? null}
      lineItems={lineItems}
      totalCents={total}
      balanceCents={balance}
      approvedAt={approvedAt}
      clientName={contact?.first_name ?? null}
      photoUrls={photoUrls}
    />
  )
}
