import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resolveLocale } from '@/lib/i18n'
import { ClientsView, type ClientRow } from './clients-view'

// Owner-facing clients screen (CRM loop). The dashboard and onboarding
// CTAs link here ("Agregar cliente"); until this page existed they
// dead-ended on a raw 404. Server component pre-loads the org's
// contacts (RLS-scoped); adding a client POSTs to /api/clients.
export default async function ClientsPage() {
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

  const { data: contacts } = await supabase
    .from('contacts')
    .select('id, first_name, phone, created_at')
    .eq('organization_id', profile.organization_id)
    .order('created_at', { ascending: false })
    .limit(500)

  const clients: ClientRow[] = (contacts ?? []).map((c: any) => ({
    id: c.id,
    first_name: c.first_name ?? '',
    phone: c.phone ?? '',
  }))

  return <ClientsView locale={locale} initialClients={clients} />
}
