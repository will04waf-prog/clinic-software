import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { BillingCard } from '@/components/settings/billing-card'

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*, organization:organizations(*)')
    .eq('id', user.id)
    .single()

  const org = profile?.organization

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header title="Settings" subtitle="Clinic and account configuration" />

      <div className="flex-1 overflow-y-auto p-6 space-y-4 max-w-2xl">
        <Card>
          <CardHeader><CardTitle>Clinic</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Name</span>
              <span className="font-medium text-gray-900">{org?.name ?? '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Plan</span>
              <span className="font-medium text-gray-900 capitalize">{org?.plan ?? '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Timezone</span>
              <span className="font-medium text-gray-900">{org?.timezone ?? '—'}</span>
            </div>
          </CardContent>
        </Card>

        <BillingCard
          planStatus={org?.plan_status ?? 'trial'}
          hasStripeCustomer={!!org?.stripe_customer_id}
        />

        <Card>
          <CardHeader><CardTitle>Your Account</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Name</span>
              <span className="font-medium text-gray-900">{profile?.full_name ?? '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Email</span>
              <span className="font-medium text-gray-900">{profile?.email ?? '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Role</span>
              <span className="font-medium text-gray-900 capitalize">{profile?.role ?? '—'}</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
