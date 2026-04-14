import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Sidebar } from '@/components/layout/sidebar'
import { TrialBanner } from '@/components/layout/trial-banner'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_super_admin, organization:organizations(plan_status, trial_ends_at)')
    .eq('id', user.id)
    .single()

  const org = profile?.organization as any

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <Sidebar isSuperAdmin={profile?.is_super_admin === true} />
      <main className="flex flex-1 flex-col overflow-hidden">
        {org && !profile?.is_super_admin && (
          <TrialBanner
            planStatus={org.plan_status ?? 'trial'}
            trialEndsAt={org.trial_ends_at ?? null}
          />
        )}
        {children}
      </main>
    </div>
  )
}
