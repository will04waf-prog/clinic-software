import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resolveLocale } from '@/lib/i18n'
import { EstimateBuilder, type ClientOption } from '../estimate-builder'

// Owner-facing estimate builder. Server component resolves the owner's
// locale + pre-loads the org's contacts (org-scoped) so the client-picker
// dropdown renders instantly. New clients are added inline via POST /api/clients.
export default async function NewEstimatePage() {
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

  // Org-scoped contacts for the picker.
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

  return <EstimateBuilder locale={locale} initialClients={clients} />
}
