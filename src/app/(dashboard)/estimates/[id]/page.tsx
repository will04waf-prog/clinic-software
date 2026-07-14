import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resolveLocale } from '@/lib/i18n'
import { EstimateDetail, type EstimateDetailData } from './estimate-detail'

// Owner-facing estimate detail. Server component: resolves the owner's
// locale + loads the estimate (org-scoped) with its line items + client,
// then hands off to the client view (Send / share the approval link).
export default async function EstimateDetailPage({ params }: { params: Promise<{ id: string }> }) {
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

  const { data: estimate } = await supabase
    .from('estimates')
    .select('id, estimate_number, status, title, subtotal_cents, tax_cents, total_cents, notes, approved_at, contact:contacts(first_name, phone)')
    .eq('id', id)
    .eq('organization_id', profile.organization_id)
    .single()
  if (!estimate) notFound()

  const { data: lineItems } = await supabase
    .from('estimate_line_items')
    .select('id, description, quantity, unit_price_cents, position')
    .eq('estimate_id', id)
    .eq('organization_id', profile.organization_id)
    .order('position', { ascending: true })

  const contact = (estimate.contact ?? null) as { first_name?: string } | null
  const data: EstimateDetailData = {
    id: estimate.id,
    estimateNumber: estimate.estimate_number,
    status: estimate.status,
    title: estimate.title ?? '',
    clientName: contact?.first_name ?? '',
    approvedAt: estimate.approved_at ?? null,
    subtotalCents: estimate.subtotal_cents,
    taxCents: estimate.tax_cents,
    totalCents: estimate.total_cents,
    notes: estimate.notes ?? '',
    lineItems: (lineItems ?? []).map((li: any) => ({
      id: li.id,
      description: li.description,
      quantity: Number(li.quantity),
      unitPriceCents: li.unit_price_cents,
    })),
  }

  return <EstimateDetail locale={locale} estimate={data} />
}
