import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resolveLocale } from '@/lib/i18n'
import { MedspaDashboard } from './medspa-dashboard'
import { LandscapingDashboard } from './landscaping-dashboard'

/**
 * Vertical-aware dashboard entry. Resolves the org's vertical SERVER-side
 * (no client probe, no loading flash) and branches:
 *   - med-spa → the Layla-centric Morning Briefing, byte-for-byte
 *     unchanged (rendered directly, exactly as before the pivot).
 *   - landscaping / any non-med-spa → the Spanish loop home.
 */
export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, organizations(vertical, owner_language)')
    .eq('id', user.id)
    .single()

  const org = (profile?.organizations ?? null) as { vertical?: string; owner_language?: string } | null
  const vertical = org?.vertical ?? 'medspa'

  if (vertical === 'medspa') return <MedspaDashboard />

  const firstName = (profile?.full_name ?? '').trim().split(' ')[0] || null
  return <LandscapingDashboard locale={resolveLocale(org?.owner_language)} ownerName={firstName} />
}
