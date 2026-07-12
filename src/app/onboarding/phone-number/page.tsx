/**
 * Phase 5 M3 — in-app onboarding flow for clinic phone-number purchase.
 *
 * Why a dedicated /onboarding sub-route instead of folding this into the
 * existing /onboarding (procedure picker):
 *   - The picker is a single-PATCH form; the phone purchase is a
 *     multi-step async dance (Twilio buy → Vapi register → A2P brand →
 *     A2P campaign) that can take minutes and may fail mid-way. Putting
 *     it on its own URL gives owners a stable place to come back to if
 *     the tab is closed mid-provision.
 *   - The route is intentionally NOT under (dashboard)/ — the dashboard
 *     layout renders the cream/teal sidebar, which is wrong for a
 *     first-time setup wizard. We want a focused single-column flow
 *     that mirrors the existing /onboarding visual treatment.
 *
 * Why owner-only:
 *   - Buying a number commits the org to a monthly Twilio rent
 *     ($1.15+/mo) and binds the org to a US A2P brand registration that
 *     includes EIN. Staff and admins should not be able to sign the
 *     clinic up for that obligation; only the owner can.
 *
 * Why redirect away when vapi_phone_number_id is already set:
 *   - Idempotency. A number is already provisioned; sending the owner
 *     through search/buy again would surface "already has a number"
 *     errors from M2's provision route and look like a bug.
 *   - The settings/call-agent card is the maintenance surface; this
 *     page is the first-time-setup surface. They are deliberately
 *     separate. If we ever support number replacement (port out, change
 *     area code) it should be a deliberate workflow on /settings, not
 *     this onboarding wizard.
 *
 * Trial-expiration: /onboarding/* is exempted from the trial-expired
 * redirect in src/proxy.ts (startsWith('/onboarding')), so freshly-
 * signed-up owners whose plan_status is still 'trial' can complete the
 * flow without the trial-gate intercepting.
 */

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isDenied, OWNER_ONLY, requireRole } from '@/lib/auth/roles'
import { PhoneNumberOnboardingClient } from '@/components/onboarding/phone-number-onboarding-client'

export const dynamic = 'force-dynamic'

export default async function PhoneNumberOnboardingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // The proxy already 302s unauthenticated users to /login before they
  // reach this render, but defense-in-depth: if for any reason the user
  // is null here (e.g. a race during sign-in), do not crash the page.
  if (!user) {
    redirect('/login')
  }

  const gate = await requireRole(supabase, user.id, OWNER_ONLY)
  if (isDenied(gate)) {
    // Non-owner staff/admin lands on dashboard with no special message.
    // Surfacing "you're not allowed here" would be confusing if they
    // navigated by accident — the owner-only surface simply doesn't
    // exist for them.
    redirect('/dashboard')
  }
  const { orgId } = gate

  const { data: org } = await supabase
    .from('organizations')
    .select('id, name, vertical, vapi_phone_number_id, twilio_phone_number, a2p_status, a2p_brand_data')
    .eq('id', orgId)
    .single()

  // Already-provisioned short-circuit. We check vapi_phone_number_id
  // specifically (not just twilio_phone_number) because the legacy
  // shared-Twilio-number deployment may have a twilio_phone_number on
  // the row without the Vapi binding completed; those orgs DO need to
  // run through the rest of the flow.
  if (org?.vapi_phone_number_id) {
    redirect('/dashboard')
  }

  return (
    <PhoneNumberOnboardingClient
      orgName={org?.name ?? 'your clinic'}
      orgId={orgId}
      existingBrandData={(org?.a2p_brand_data as Record<string, unknown> | null) ?? null}
      a2pStatus={(org?.a2p_status as string | null) ?? 'not_started'}
      vertical={(org?.vertical as string | null) ?? null}
    />
  )
}
