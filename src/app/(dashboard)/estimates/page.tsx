import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resolveLocale } from '@/lib/i18n'
import { EstimatesList } from './estimates-list'

// Owner-facing estimates list. Server component resolves the owner's
// locale from the org; the list itself is a client component that
// fetches GET /api/estimates (org-scoped on the API side).
export default async function EstimatesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('organizations(owner_language)')
    .eq('id', user.id)
    .single()

  const org = (profile?.organizations ?? null) as { owner_language?: string } | null
  const locale = resolveLocale(org?.owner_language)

  return <EstimatesList locale={locale} />
}
