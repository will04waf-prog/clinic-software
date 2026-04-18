import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { BillingCard } from '@/components/settings/billing-card'
import { ServicesCard } from '@/components/settings/services-card'
import { CaptureFormCard } from '@/components/settings/capture-form-card'
import { SmsSettingsCard } from '@/components/settings/sms-settings-card'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://tarhunna.net'

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select(`
      full_name, email, role,
      organization:organizations(
        name, slug, plan, timezone, plan_status, stripe_customer_id, procedures,
        sms_enabled, sms_confirmation_enabled, sms_reminder_24h_enabled, sms_reminder_2h_enabled,
        sms_template_confirmation, sms_template_reminder_24h, sms_template_reminder_2h
      )
    `)
    .eq('id', user.id)
    .single()

  const org = profile?.organization as any

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

        {org?.slug && (
          <CaptureFormCard url={`${APP_URL}/capture/${org.slug}`} />
        )}

        <ServicesCard initial={org?.procedures ?? null} />

        <SmsSettingsCard initial={{
          sms_enabled:               org?.sms_enabled               ?? false,
          sms_confirmation_enabled:  org?.sms_confirmation_enabled  ?? true,
          sms_reminder_24h_enabled:  org?.sms_reminder_24h_enabled  ?? true,
          sms_reminder_2h_enabled:   org?.sms_reminder_2h_enabled   ?? true,
          sms_template_confirmation: org?.sms_template_confirmation ?? null,
          sms_template_reminder_24h: org?.sms_template_reminder_24h ?? null,
          sms_template_reminder_2h:  org?.sms_template_reminder_2h  ?? null,
        }} />

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
