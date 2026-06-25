import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { computeAvailableSlots } from '@/lib/booking/availability'

/**
 * GET /api/booking/public/[slug]/availability?serviceId=&from=&to=
 *
 * Anonymous-readable slot lookup. Mirrors the authenticated
 * /api/booking/availability endpoint's contract but locks every
 * query to the org resolved from the URL slug.
 *
 * Refuses with 403 when booking_enabled is false, 400 when the
 * service is missing/inactive/not-bookable-online, 503 when the
 * org has no timezone configured. Padded windows (±1 day for
 * overrides, ±240 min for existing-bookings buffer) match the
 * W1 fix for the authenticated route.
 */

const MAX_HORIZON_DAYS = 60

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params
  const url = new URL(req.url)
  const serviceId = url.searchParams.get('serviceId') ?? ''
  const fromStr   = url.searchParams.get('from')      ?? ''
  const toStr     = url.searchParams.get('to')        ?? ''

  if (!slug)      return NextResponse.json({ error: 'invalid_slug' },      { status: 400 })
  if (!serviceId) return NextResponse.json({ error: 'serviceId required' },{ status: 400 })

  const fromUtc = fromStr ? new Date(fromStr) : new Date()
  const toUtc   = toStr   ? new Date(toStr)   : new Date(fromUtc.getTime() + 14 * 24 * 60 * 60 * 1000)
  if (Number.isNaN(fromUtc.getTime()) || Number.isNaN(toUtc.getTime())) {
    return NextResponse.json({ error: 'invalid date range' }, { status: 400 })
  }
  if (toUtc.getTime() <= fromUtc.getTime()) {
    return NextResponse.json({ error: 'to must be after from' }, { status: 400 })
  }
  if (toUtc.getTime() - fromUtc.getTime() > MAX_HORIZON_DAYS * 24 * 60 * 60 * 1000) {
    return NextResponse.json({ error: `range cannot exceed ${MAX_HORIZON_DAYS} days` }, { status: 400 })
  }

  // Resolve org + verify booking is enabled.
  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('id, timezone, booking_enabled')
    .eq('slug', slug)
    .maybeSingle()
  if (!org)                  return NextResponse.json({ error: 'not_found' },          { status: 404 })
  if (!org.timezone)         return NextResponse.json({ error: 'org_timezone_missing' }, { status: 503 })
  if (!org.booking_enabled)  return NextResponse.json({ error: 'booking_disabled' },     { status: 403 })
  const orgId = org.id as string
  const timezone = org.timezone as string

  // Service — must be active AND bookable online.
  const { data: service } = await supabaseAdmin
    .from('services')
    .select('id, duration_min, lead_time_hours, booking_horizon_days, is_active, is_bookable_online')
    .eq('id', serviceId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!service || !service.is_active || !service.is_bookable_online) {
    return NextResponse.json({ error: 'service_not_bookable' }, { status: 404 })
  }

  // Providers who can perform the service.
  const { data: spRows } = await supabaseAdmin
    .from('service_providers')
    .select('provider_id')
    .eq('organization_id', orgId)
    .eq('service_id', serviceId)
  const providerIds = (spRows ?? []).map(r => r.provider_id)
  if (providerIds.length === 0) return NextResponse.json({ slots: [], timezone })

  const { data: providerRows } = await supabaseAdmin
    .from('providers')
    .select('id, buffer_before_min, buffer_after_min, is_active')
    .eq('organization_id', orgId)
    .in('id', providerIds)
  const providers = (providerRows ?? [])
    .filter(p => p.is_active)
    .map(p => ({
      id:              p.id,
      bufferBeforeMin: p.buffer_before_min ?? 0,
      bufferAfterMin:  p.buffer_after_min  ?? 0,
    }))
  if (providers.length === 0) return NextResponse.json({ slots: [], timezone })

  const activeProviderIds = providers.map(p => p.id)

  // Rules + overrides + bookings, with the same window paddings the
  // authenticated route applies.
  const [rulesRes, overridesRes, bookingsRes] = await Promise.all([
    supabaseAdmin
      .from('availability_rules')
      .select('provider_id, weekday, start_time, end_time')
      .eq('organization_id', orgId)
      .in('provider_id', activeProviderIds),
    supabaseAdmin
      .from('availability_overrides')
      .select('provider_id, kind, date, start_time, end_time')
      .eq('organization_id', orgId)
      .gte('date', new Date(fromUtc.getTime() - 86_400_000).toISOString().slice(0, 10))
      .lte('date', new Date(toUtc.getTime()   + 86_400_000).toISOString().slice(0, 10)),
    supabaseAdmin
      .from('consultations')
      .select('provider_id, scheduled_at, end_at, status')
      .eq('organization_id', orgId)
      .in('provider_id', activeProviderIds)
      .in('status', ['hold', 'scheduled', 'confirmed'])
      .gte('end_at',       new Date(fromUtc.getTime() - 240 * 60 * 1000).toISOString())
      .lte('scheduled_at', new Date(toUtc.getTime()   + 240 * 60 * 1000).toISOString()),
  ])

  if (rulesRes.error || overridesRes.error || bookingsRes.error) {
    return NextResponse.json({ error: 'availability_lookup_failed' }, { status: 500 })
  }

  const rules = (rulesRes.data ?? []).map(r => ({
    providerId: r.provider_id,
    weekday:    r.weekday,
    startTime:  r.start_time,
    endTime:    r.end_time,
  }))

  const activeSet = new Set(activeProviderIds)
  const overrides = (overridesRes.data ?? [])
    .filter(o => o.provider_id === null || activeSet.has(o.provider_id))
    .map(o => ({
      providerId: o.provider_id as string | null,
      kind:       o.kind as 'closed' | 'custom',
      date:       o.date,
      startTime:  o.start_time as string | null,
      endTime:    o.end_time   as string | null,
    }))

  const existingBookings = (bookingsRes.data ?? [])
    .filter(b => b.provider_id && b.scheduled_at && b.end_at)
    .map(b => ({
      providerId: b.provider_id as string,
      startUtc:   new Date(b.scheduled_at as string),
      endUtc:     new Date(b.end_at as string),
    }))

  const slots = computeAvailableSlots({
    fromUtc,
    toUtc,
    timezone,
    service: {
      id:                 service.id,
      durationMin:        service.duration_min,
      leadTimeHours:      service.lead_time_hours,
      bookingHorizonDays: service.booking_horizon_days,
    },
    providers,
    rules,
    overrides,
    existingBookings,
    now: new Date(),
  })

  return NextResponse.json({ slots, timezone })
}
