import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

/**
 * GET /api/booking/public/[slug] — Phase 4 W2.
 *
 * Anonymous-readable endpoint that powers the /book/[slug] page.
 * Returns the org's display info + the services and providers a
 * patient is allowed to see + book online.
 *
 * Uses the service-role client (RLS bypass) deliberately: anonymous
 * patients don't have a session, so we authorize at the API layer
 * by:
 *   1. Looking the org up by slug (organizations.slug is the org's
 *      public handle — same one /capture/[slug] uses).
 *   2. Refusing if booking_enabled is false (master kill switch).
 *   3. Filtering services to is_active AND is_bookable_online so
 *      "back-office" services don't surface publicly.
 *   4. Filtering providers to is_active.
 *   5. Stripping any field that isn't safe to expose (org email,
 *      Stripe customer IDs, etc).
 *
 * NO writes here. Hold/confirm live in sibling routes.
 */

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params

  if (!slug || slug.length < 1 || slug.length > 80) {
    return NextResponse.json({ error: 'invalid_slug' }, { status: 400 })
  }

  // Org by slug. Use admin client because patient has no session.
  const { data: org, error: orgErr } = await supabaseAdmin
    .from('organizations')
    .select('id, name, slug, timezone, booking_enabled')
    .eq('slug', slug)
    .maybeSingle()

  if (orgErr) return NextResponse.json({ error: orgErr.message }, { status: 500 })
  if (!org) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (!org.timezone) return NextResponse.json({ error: 'org_timezone_missing' }, { status: 503 })
  if (!org.booking_enabled) {
    return NextResponse.json(
      {
        error: 'booking_disabled',
        message: 'Online booking is paused for this clinic right now.',
      },
      { status: 403 },
    )
  }

  // Bookable services + active providers + the join.
  const [servicesRes, providersRes, linksRes] = await Promise.all([
    supabaseAdmin
      .from('services')
      .select('id, name, description, duration_min, price_cents, lead_time_hours, booking_horizon_days, color, position')
      .eq('organization_id', org.id)
      .eq('is_active', true)
      .eq('is_bookable_online', true)
      .order('position', { ascending: true })
      .order('name', { ascending: true }),
    supabaseAdmin
      .from('providers')
      .select('id, display_name, role_label, photo_url')
      .eq('organization_id', org.id)
      .eq('is_active', true)
      .order('display_name', { ascending: true }),
    supabaseAdmin
      .from('service_providers')
      .select('service_id, provider_id')
      .eq('organization_id', org.id),
  ])

  if (servicesRes.error)  return NextResponse.json({ error: servicesRes.error.message },  { status: 500 })
  if (providersRes.error) return NextResponse.json({ error: providersRes.error.message }, { status: 500 })
  if (linksRes.error)     return NextResponse.json({ error: linksRes.error.message },     { status: 500 })

  // Group provider ids per service so the page can route slot
  // lookups for a specific service to the right provider pool.
  const byService = new Map<string, string[]>()
  for (const r of linksRes.data ?? []) {
    const list = byService.get(r.service_id) ?? []
    list.push(r.provider_id)
    byService.set(r.service_id, list)
  }

  const services = (servicesRes.data ?? []).map(s => ({
    ...s,
    provider_ids: (byService.get(s.id) ?? []).filter(pid =>
      (providersRes.data ?? []).some(p => p.id === pid),
    ),
  }))

  return NextResponse.json({
    org: {
      id:       org.id,
      name:     org.name,
      slug:     org.slug,
      timezone: org.timezone,
    },
    services,
    providers: providersRes.data ?? [],
  })
}
