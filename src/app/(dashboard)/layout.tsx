import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Sidebar } from '@/components/layout/sidebar'
import { TrialBanner } from '@/components/layout/trial-banner'
import { MobileNav } from '@/components/layout/mobile-nav'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_super_admin, role, organization:organizations(plan_status, trial_ends_at, vertical, owner_language)')
    .eq('id', user.id)
    .single()

  const org = profile?.organization as any
  const vertical = org?.vertical ?? 'medspa'
  const ownerLanguage = org?.owner_language ?? undefined

  return (
    <div className="flex h-dvh overflow-hidden bg-[#F5EFE1] pt-[env(safe-area-inset-top)]">
      <Sidebar
        isSuperAdmin={profile?.is_super_admin === true}
        isOwner={profile?.role === 'owner'}
        vertical={vertical}
        ownerLanguage={ownerLanguage}
      />
      <main className="flex flex-1 flex-col overflow-hidden pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">
        {org && !profile?.is_super_admin && (
          <TrialBanner
            planStatus={org.plan_status ?? 'trial'}
            trialEndsAt={org.trial_ends_at ?? null}
          />
        )}
        {children}
      </main>
      <MobileNav vertical={vertical} ownerLanguage={ownerLanguage} />
    </div>
  )
}
