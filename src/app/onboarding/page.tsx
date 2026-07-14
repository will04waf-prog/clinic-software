import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resolveLocale } from '@/lib/i18n'
import { LoopOnboarding } from './loop-onboarding'
import { MedspaOnboarding } from './medspa-onboarding'

// Vertical-aware onboarding. Med-spa keeps its service picker (unchanged);
// landscaping (and future service verticals) get the Spanish loop-teaching
// screen. Server component so it can read the org's vertical + language.
export default async function OnboardingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, organizations(vertical, owner_language)')
    .eq('id', user.id)
    .single()

  const org = (profile?.organizations ?? null) as { vertical?: string; owner_language?: string } | null
  const vertical = org?.vertical ?? 'landscaping'

  if (vertical === 'medspa') return <MedspaOnboarding />

  const firstName = (profile?.full_name ?? '').trim().split(' ')[0] || 'amigo'
  return <LoopOnboarding locale={resolveLocale(org?.owner_language)} ownerName={firstName} />
}
