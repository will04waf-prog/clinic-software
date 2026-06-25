import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Header } from '@/components/layout/header'
import { BookingMasterToggleCard } from '@/components/settings/booking/booking-master-toggle-card'
import { BookingProvidersCard } from '@/components/settings/booking/booking-providers-card'
import { BookingServicesCard } from '@/components/settings/booking/booking-services-card'
import { ProviderWeeklyHoursCard } from '@/components/settings/booking/provider-weekly-hours-card'
import { AvailabilityOverridesCard } from '@/components/settings/booking/availability-overrides-card'
import { AvailabilityPreviewCard } from '@/components/settings/booking/availability-preview-card'

export default async function BookingSettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization:organizations(timezone)')
    .eq('id', user.id)
    .single()

  // The PostgREST shape can be array-or-object depending on the join inference;
  // existing settings/page.tsx casts to `any` for the same reason.
  const org = profile?.organization as any
  const timezone =
    (Array.isArray(org) ? org[0]?.timezone : org?.timezone) ?? null

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header
        title="Booking calendar"
        subtitle="Providers, services, hours, and overrides that drive your bookable calendar"
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-4 max-w-4xl">
        <Link
          href="/settings"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-brand-700"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to settings
        </Link>

        <BookingMasterToggleCard />
        <BookingProvidersCard />
        <BookingServicesCard />
        <ProviderWeeklyHoursCard timezone={timezone} />
        <AvailabilityOverridesCard timezone={timezone} />
        <AvailabilityPreviewCard timezone={timezone} />
      </div>
    </div>
  )
}
