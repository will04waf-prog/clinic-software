/**
 * Phase 5 W1 — /settings/call-agent.
 *
 * Owner-only. Tier-gated to Scale via allowsCallAgent (the API
 * returns 402 LockedBody for non-Scale orgs and the UI swaps to
 * UpgradeCardLocked).
 *
 * The page bundles four sub-cards:
 *   1. BAA attestation (required to enable agent)
 *   2. Main toggle + mode (off / after_hours / always)
 *   3. Fallback number (for safety handoff + when mode=after_hours
 *      during business hours)
 *   4. Greeting (custom or default)
 *
 * Business-hours editing is intentionally hidden in V1 — the API
 * stores arbitrary jsonb and the booking-settings page already has
 * a weekly hours editor for the bookable calendar. W2 wires them
 * together; until then the agent uses the booking weekly hours by
 * convention or a default of 9am-5pm Mon-Fri.
 */

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Header } from '@/components/layout/header'
import { CallAgentSettingsCard } from '@/components/settings/call-agent/call-agent-settings-card'
import { ClinicAddressCard, type ClinicAddressInitial } from '@/components/settings/call-agent/clinic-address-card'

export default async function CallAgentSettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Owner-only — defense in depth (the API also enforces this).
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, organization_id')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'owner') redirect('/settings')

  // Load existing clinic-address values so the form can hydrate. The
  // server action does its own owner check on save, so a null org id
  // here would have been caught by the role guard above.
  const { data: org } = await supabase
    .from('organizations')
    .select('address_line1, address_line2, city, region, postal_code, country_code, google_place_id, directions_notes')
    .eq('id', profile.organization_id as string)
    .single()

  const initialAddress: ClinicAddressInitial = {
    address_line1:    org?.address_line1    ?? null,
    address_line2:    org?.address_line2    ?? null,
    city:             org?.city             ?? null,
    region:           org?.region           ?? null,
    postal_code:      org?.postal_code      ?? null,
    country_code:     org?.country_code     ?? null,
    google_place_id:  org?.google_place_id  ?? null,
    directions_notes: org?.directions_notes ?? null,
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header
        title="Call agent"
        subtitle="The AI receptionist that answers your phone after hours"
      />
      <div className="flex-1 overflow-y-auto p-6 space-y-4 max-w-3xl">
        <Link
          href="/settings"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-brand-700"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to settings
        </Link>

        <CallAgentSettingsCard />
        <ClinicAddressCard initial={initialAddress} />
      </div>
    </div>
  )
}
