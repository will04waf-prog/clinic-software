import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { computeAvailableSlots } from '@/lib/booking/availability'

// ─── GET /api/booking/availability ────────────────────────────
// Query params:
//   serviceId  (required) — uuid
//   from       (required) — ISO datetime, lower bound of search window
//   to         (required) — ISO datetime, upper bound of search window
//   slotStep   (optional) — minutes between candidate slot starts (default 15)
export async function GET(req: NextRequest) {
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
  const { searchParams } = new URL(req.url)
  const serviceId = searchParams.get('serviceId')
  const fromStr = searchParams.get('from')
  const toStr = searchParams.get('to')
  const slotStepStr = searchParams.get('slotStep')

  if (!serviceId) return NextResponse.json({ error: 'serviceId is required' }, { status: 400 })
  if (!fromStr)   return NextResponse.json({ error: 'from is required' }, { status: 400 })
  if (!toStr)     return NextResponse.json({ error: 'to is required' }, { status: 400 })

  const fromUtc = new Date(fromStr)
  const toUtc = new Date(toStr)
  if (isNaN(fromUtc.getTime()) || isNaN(toUtc.getTime())) {
    return NextResponse.json({ error: 'from/to must be valid ISO datetimes' }, { status: 400 })
  }
  if (fromUtc >= toUtc) {
    return NextResponse.json({ error: 'from must be before to' }, { status: 400 })
  }

  const slotStepMin = slotStepStr ? Number(slotStepStr) : 15
  if (!Number.isFinite(slotStepMin) || slotStepMin < 5 || slotStepMin > 120) {
    return NextResponse.json({ error: 'slotStep must be between 5 and 120 minutes' }, { status: 400 })
  }

  // Org timezone.
  const { data: org } = await supabase
    .from('organizations')
    .select('timezone')
    .eq('id', orgId)
    .single()

  // Fail loudly if the org never configured a timezone. The previous
  // hardcoded 'America/New_York' fallback silently aligned every
  // unset-timezone clinic to Eastern, mis-scheduling West Coast and
  // international orgs. The engine itself also bails on missing tz,
  // but surfacing the error here makes the misconfiguration
  // observable to the UI.
  const timezone = (org?.timezone as string | undefined) ?? null
  if (!timezone) {
    return NextResponse.json(
      {
        slots: [],
        timezone: null,
        error: 'organization_timezone_missing',
        message: 'Clinic timezone is not configured — set it in Settings → Clinic before computing availability.',
      },
      { status: 400 },
    )
  }

  // Service.
  const { data: service, error: serviceErr } = await supabase
    .from('services')
    .select('id, duration_min, lead_time_hours, booking_horizon_days, is_active')
    .eq('id', serviceId)
    .eq('organization_id', orgId)
    .maybeSingle()

  if (serviceErr) return NextResponse.json({ error: serviceErr.message }, { status: 500 })
  if (!service || !service.is_active) {
    return NextResponse.json({ error: 'Service not found' }, { status: 404 })
  }

  // Providers who can perform this service (active only).
  const { data: spRows } = await supabase
    .from('service_providers')
    .select('provider_id')
    .eq('organization_id', orgId)
    .eq('service_id', serviceId)

  const providerIds = (spRows ?? []).map((r) => r.provider_id)
  if (providerIds.length === 0) {
    return NextResponse.json({ slots: [], timezone })
  }

  const { data: providerRows } = await supabase
    .from('providers')
    .select('id, buffer_before_min, buffer_after_min, is_active')
    .eq('organization_id', orgId)
    .in('id', providerIds)

  const providers = (providerRows ?? [])
    .filter((p) => p.is_active)
    .map((p) => ({
      id:              p.id,
      bufferBeforeMin: p.buffer_before_min ?? 0,
      bufferAfterMin:  p.buffer_after_min ?? 0,
    }))

  if (providers.length === 0) {
    return NextResponse.json({ slots: [], timezone })
  }

  const activeProviderIds = providers.map((p) => p.id)

  // Rules + overrides for these providers (overrides also include clinic-wide rows with provider_id IS NULL).
  const [rulesRes, overridesRes] = await Promise.all([
    supabase
      .from('availability_rules')
      .select('provider_id, weekday, start_time, end_time')
      .eq('organization_id', orgId)
      .in('provider_id', activeProviderIds),
    supabase
      .from('availability_overrides')
      .select('provider_id, kind, date, start_time, end_time')
      .eq('organization_id', orgId)
      // availability_overrides.date is a CLINIC-LOCAL calendar date,
      // but fromUtc.toISOString().slice(0,10) is the UTC date. For a
      // West Coast clinic, the local date can be 1 day BEHIND the UTC
      // date around midnight. Pad the SQL window by ±1 day so we never
      // miss an edge-date override — the engine filters by exact
      // clinic-local date downstream so over-fetching is harmless.
      .gte('date', new Date(fromUtc.getTime() - 86_400_000).toISOString().slice(0, 10))
      .lte('date', new Date(toUtc.getTime()   + 86_400_000).toISOString().slice(0, 10)),
  ])

  if (rulesRes.error)     return NextResponse.json({ error: rulesRes.error.message }, { status: 500 })
  if (overridesRes.error) return NextResponse.json({ error: overridesRes.error.message }, { status: 500 })

  const rules = (rulesRes.data ?? []).map((r) => ({
    providerId: r.provider_id,
    weekday:    r.weekday,
    startTime:  r.start_time,
    endTime:    r.end_time,
  }))

  // Keep clinic-wide overrides (provider_id IS NULL) and any provider-scoped ones for active providers.
  const activeSet = new Set(activeProviderIds)
  const overrides = (overridesRes.data ?? [])
    .filter((o) => o.provider_id === null || activeSet.has(o.provider_id))
    .map((o) => ({
      providerId: o.provider_id as string | null,
      kind:       o.kind as 'closed' | 'custom',
      date:       o.date,
      startTime:  o.start_time as string | null,
      endTime:    o.end_time as string | null,
    }))

  // Existing bookings — hold/scheduled/confirmed across the window for these providers.
  const { data: bookingRows, error: bookingErr } = await supabase
    .from('consultations')
    .select('provider_id, scheduled_at, end_at, status')
    .eq('organization_id', orgId)
    .in('provider_id', activeProviderIds)
    .in('status', ['hold', 'scheduled', 'confirmed'])
    // Pad the bookings window by the hard buffer cap (240 min, per
    // the providers.buffer_*_min CHECK) so neighboring appointments
    // outside the requested window still block candidate slots at
    // the window edges. Engine filters per-provider downstream so
    // over-fetching ~4h on each side is cheap.
    .gte('end_at',       new Date(fromUtc.getTime() - 240 * 60 * 1000).toISOString())
    .lte('scheduled_at', new Date(toUtc.getTime()   + 240 * 60 * 1000).toISOString())

  if (bookingErr) return NextResponse.json({ error: bookingErr.message }, { status: 500 })

  const existingBookings = (bookingRows ?? [])
    .filter((b) => b.provider_id && b.scheduled_at && b.end_at)
    .map((b) => ({
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
    slotStepMin,
    now: new Date(),
  })

  return NextResponse.json({ slots, timezone })
}
