import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resolveLocale } from '@/lib/i18n'
import { InvoiceBuilder, type ClientOption, type EstimateOption } from '../invoice-builder'

// Owner-facing invoice builder. Server component resolves the owner's
// locale + pre-loads the org's contacts (for the direct path) and the
// org's APPROVED estimates (for the copy-from-estimate path) so both
// pickers render instantly.
export default async function NewInvoicePage() {
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

  // Org-scoped contacts for the direct-invoice picker.
  const { data: contacts } = await supabase
    .from('contacts')
    .select('id, first_name, phone')
    .eq('organization_id', profile.organization_id)
    .order('first_name', { ascending: true })
    .limit(500)

  const clients: ClientOption[] = (contacts ?? []).map((c: any) => ({
    id: c.id,
    first_name: c.first_name ?? '',
    phone: c.phone ?? null,
  }))

  // Approved estimates → the one-tap "invoice this estimate" path.
  const { data: estimates } = await supabase
    .from('estimates')
    .select('id, estimate_number, title, total_cents, contact:contacts(first_name)')
    .eq('organization_id', profile.organization_id)
    .eq('status', 'approved')
    .order('created_at', { ascending: false })
    .limit(200)

  const approvedEstimates: EstimateOption[] = (estimates ?? []).map((e: any) => {
    const contact = Array.isArray(e.contact) ? e.contact[0] : e.contact
    return {
      id: e.id,
      estimate_number: e.estimate_number,
      title: e.title ?? '',
      total_cents: e.total_cents ?? 0,
      first_name: contact?.first_name ?? null,
    }
  })

  return (
    <InvoiceBuilder
      locale={locale}
      initialClients={clients}
      approvedEstimates={approvedEstimates}
    />
  )
}
