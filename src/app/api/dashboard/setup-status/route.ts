import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { cached } from '@/lib/route-cache'
import { effectiveTierFor } from '@/lib/billing/org-tier'
import { TIER_DISPLAY_NAMES } from '@/lib/billing/tiers'

// Short cache. Setup signals change only when the owner completes a step
// (adds a service, imports contacts, turns Layla on) — which almost always
// involves navigating away and back, well past the TTL. Keeping it short
// means the checklist ticks over promptly instead of feeling stuck.
const SETUP_CACHE_TTL_MS = 20_000

/**
 * GET /api/dashboard/setup-status
 *
 * Powers the "Get Layla live" activation guide on the dashboard. Returns
 * the org's tier + a flat set of boolean setup signals; the SetupGuide
 * component owns the copy, links, grouping, and tier-lock UI.
 *
 * The signals map to concrete setup steps:
 *   Foundation (all tiers)      hasServices, hasHours, bookingEnabled,
 *                               hasContacts, smsLive
 *   AI Twin (Pro/Scale)         aiTwinTrained
 *   Layla voice (Scale)         hasPhoneNumber, hasFaqs, baaAttested, laylaLive
 *
 * Org-isolated via RLS + an explicit organization_id filter on every query.
 */
export async function GET() {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single()
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  const orgId = profile.organization_id

  const cacheKey = `setup-status:${orgId}`
  const payload = await cached(cacheKey, SETUP_CACHE_TTL_MS, () => buildSetupStatus(supabase, orgId))
  if (!payload) return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
  return NextResponse.json(payload)
}

async function buildSetupStatus(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
) {
  const [orgRes, servicesRes, hoursRes, contactsRes, voiceRes] = await Promise.all([
    supabase
      .from('organizations')
      .select('slug, booking_enabled, sms_enabled, vapi_phone_number_id, call_agent_enabled, call_agent_baa_attested_at, faqs, plan, plan_status, trial_ends_at, address_line1, city')
      .eq('id', orgId)
      .single(),
    // head:true → COUNT only, no rows pulled back.
    supabase.from('services').select('*', { count: 'exact', head: true }).eq('organization_id', orgId),
    supabase.from('availability_rules').select('*', { count: 'exact', head: true }).eq('organization_id', orgId),
    supabase.from('contacts').select('*', { count: 'exact', head: true }).eq('organization_id', orgId),
    supabase.from('voice_examples').select('*', { count: 'exact', head: true }).eq('organization_id', orgId),
  ])

  const org = orgRes.data
  if (!org) return null

  // Effective tier, not raw plan — a plan_status='trial' org inside its
  // window is Scale-equivalent (org-tier.ts), so trial owners must see
  // the AI Twin + Layla groups unlocked, not "Unlock on Scale".
  const et = effectiveTierFor(org.plan, org.plan_status, org.trial_ends_at)
  const tier = et.tier
  const caps = et.limits

  const faqs = org.faqs
  const faqCount = Array.isArray(faqs) ? faqs.length : 0

  return {
    tier,
    tierName: TIER_DISPLAY_NAMES[tier],
    bookingSlug: org.slug as string | null,
    capabilities: {
      aiTwin: caps.allowsVoiceTraining,
      laylaVoice: caps.allowsCallAgent,
    },
    signals: {
      // Foundation
      hasServices: (servicesRes.count ?? 0) > 0,
      hasHours: (hoursRes.count ?? 0) > 0,
      bookingEnabled: org.booking_enabled === true,
      hasContacts: (contactsRes.count ?? 0) > 0,
      smsLive: org.sms_enabled === true,
      // AI Twin
      aiTwinTrained: (voiceRes.count ?? 0) > 0,
      // Layla voice
      hasPhoneNumber: org.vapi_phone_number_id != null,
      // Without an address, Layla's give_directions tool dead-ends on
      // "where are you located?" — one of the most common call intents.
      hasAddress: org.address_line1 != null && org.city != null,
      hasFaqs: faqCount > 0,
      baaAttested: org.call_agent_baa_attested_at != null,
      laylaLive: org.call_agent_enabled === true,
    },
  }
}
