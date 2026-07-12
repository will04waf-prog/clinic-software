import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resolveLocale } from '@/lib/i18n'
import { InvoiceDetail, type InvoiceDetailData } from './invoice-detail'

// Owner-facing invoice detail. Server component: resolves the owner's
// locale + loads the invoice (org-scoped) with its line items, client,
// and payment ledger, then hands off to the client view (record payment).
export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id, organizations(owner_language)')
    .eq('id', user.id)
    .single()
  if (!profile) redirect('/login')

  const org = (profile.organizations ?? null) as { owner_language?: string } | null
  const locale = resolveLocale(org?.owner_language)

  const { data: invoice } = await supabase
    .from('invoices')
    .select('id, invoice_number, status, title, subtotal_cents, tax_cents, total_cents, amount_paid_cents, notes, contact:contacts(first_name, phone)')
    .eq('id', id)
    .eq('organization_id', profile.organization_id)
    .single()
  if (!invoice) notFound()

  const { data: lineItems } = await supabase
    .from('invoice_line_items')
    .select('id, description, quantity, unit_price_cents, position')
    .eq('invoice_id', id)
    .eq('organization_id', profile.organization_id)
    .order('position', { ascending: true })

  const { data: payments } = await supabase
    .from('payments')
    .select('id, method, amount_cents, created_at')
    .eq('invoice_id', id)
    .eq('organization_id', profile.organization_id)
    .order('created_at', { ascending: false })

  const contact = (Array.isArray(invoice.contact) ? invoice.contact[0] : invoice.contact) as
    | { first_name?: string }
    | null

  const data: InvoiceDetailData = {
    id: invoice.id,
    invoiceNumber: invoice.invoice_number,
    status: invoice.status,
    title: invoice.title ?? '',
    clientName: contact?.first_name ?? '',
    subtotalCents: invoice.subtotal_cents,
    taxCents: invoice.tax_cents,
    totalCents: invoice.total_cents,
    amountPaidCents: invoice.amount_paid_cents,
    notes: invoice.notes ?? '',
    lineItems: (lineItems ?? []).map((li: any) => ({
      id: li.id,
      description: li.description,
      quantity: Number(li.quantity),
      unitPriceCents: li.unit_price_cents,
    })),
    payments: (payments ?? []).map((p: any) => ({
      id: p.id,
      method: p.method,
      amountCents: p.amount_cents,
      createdAt: p.created_at,
    })),
  }

  return <InvoiceDetail locale={locale} invoice={data} />
}
