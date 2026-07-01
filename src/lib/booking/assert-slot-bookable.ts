/**
 * Audit M2 + M3 — write-path slot re-validation.
 *
 * The reschedule routes and holdBookingInternal previously trusted the
 * DB EXCLUDE constraint alone to police a booking. That constraint only
 * blocks RAW same-provider time overlap — it knows nothing about
 * availability rules (open days/hours, closed overrides) or the
 * provider's configured before/after buffer. So a hand-crafted request
 * (a /manage-token holder, or Layla via the voice reschedule tool)
 * could land an appointment at 3 AM, on a closed day, or exactly
 * adjacent to another visit (violating the buffer) — none of which the
 * public picker would ever offer.
 *
 * This helper closes that gap by asking the SAME engine the offer path
 * uses (computeAvailableSlots) whether the exact target instant would be
 * offered right now. Because it delegates to that one engine, the check
 * can't drift from what patients are shown: availability rules, closed
 * overrides, lead time, horizon, and buffer-padded overlap are all
 * enforced identically.
 *
 * It is intentionally strict: a target that isn't on the offered grid
 * (arbitrary minute), out of hours, or buffer-conflicting is rejected.
 * Legit reschedules always pass a slot the picker offered, so they clear.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { computeAvailableSlots } from './availability'

export interface SlotBookableParams {
  organizationId: string
  providerId: string
  serviceId: string
  /** The target slot start (UTC). */
  startUtc: Date
  /** Injectable clock; defaults to now. */
  now?: Date
  /** Reschedule: ignore the row being moved so it doesn't block itself. */
  excludeConsultationId?: string
}

export type SlotBookableResult =
  | { ok: true }
  | { ok: false; reason: 'unavailable' | 'lookup_failed' }

const DAY_MS = 86_400_000

export async function assertSlotBookable(
  supabase: SupabaseClient,
  params: SlotBookableParams,
): Promise<SlotBookableResult> {
  const { organizationId, providerId, serviceId, startUtc } = params
  const now = params.now ?? new Date()

  const [orgRes, serviceRes, providerRes] = await Promise.all([
    supabase.from('organizations').select('timezone').eq('id', organizationId).single(),
    supabase
      .from('services')
      .select('id, duration_min, lead_time_hours, booking_horizon_days')
      .eq('id', serviceId).eq('organization_id', organizationId).single(),
    supabase
      .from('providers')
      .select('id, buffer_before_min, buffer_after_min')
      .eq('id', providerId).eq('organization_id', organizationId).single(),
  ])

  const service = serviceRes.data
  const provider = providerRes.data
  if (orgRes.error || !service || !provider) return { ok: false, reason: 'lookup_failed' }

  const timezone = orgRes.data?.timezone
  if (!timezone) return { ok: false, reason: 'lookup_failed' }

  const durationMs = service.duration_min * 60_000
  // A window wide enough to contain the target day's open intervals;
  // computeAvailableSlots clamps to lead-time/horizon internally.
  const fromUtc = new Date(startUtc.getTime() - DAY_MS)
  const toUtc = new Date(startUtc.getTime() + durationMs + DAY_MS)

  // Same reads (and paddings) as the public availability route, scoped
  // to this one provider.
  const [rulesRes, overridesRes, bookingsRes] = await Promise.all([
    supabase
      .from('availability_rules')
      .select('provider_id, weekday, start_time, end_time')
      .eq('organization_id', organizationId).eq('provider_id', providerId),
    supabase
      .from('availability_overrides')
      .select('provider_id, kind, date, start_time, end_time')
      .eq('organization_id', organizationId)
      .gte('date', new Date(fromUtc.getTime() - DAY_MS).toISOString().slice(0, 10))
      .lte('date', new Date(toUtc.getTime() + DAY_MS).toISOString().slice(0, 10)),
    supabase
      .from('consultations')
      .select('id, provider_id, scheduled_at, end_at, status')
      .eq('organization_id', organizationId).eq('provider_id', providerId)
      .in('status', ['hold', 'scheduled', 'confirmed'])
      .gte('end_at', new Date(fromUtc.getTime() - 240 * 60_000).toISOString())
      .lte('scheduled_at', new Date(toUtc.getTime() + 240 * 60_000).toISOString()),
  ])

  if (rulesRes.error || overridesRes.error || bookingsRes.error) {
    return { ok: false, reason: 'lookup_failed' }
  }

  const rules = (rulesRes.data ?? []).map((r) => ({
    providerId: r.provider_id, weekday: r.weekday, startTime: r.start_time, endTime: r.end_time,
  }))
  const overrides = (overridesRes.data ?? [])
    .filter((o) => o.provider_id === null || o.provider_id === providerId)
    .map((o) => ({
      providerId: o.provider_id as string | null,
      kind: o.kind as 'closed' | 'custom',
      date: o.date, startTime: o.start_time as string | null, endTime: o.end_time as string | null,
    }))
  const existingBookings = (bookingsRes.data ?? [])
    .filter((b) => b.provider_id && b.scheduled_at && b.end_at && b.id !== params.excludeConsultationId)
    .map((b) => ({
      providerId: b.provider_id as string,
      startUtc: new Date(b.scheduled_at as string),
      endUtc: new Date(b.end_at as string),
    }))

  const slots = computeAvailableSlots({
    fromUtc, toUtc, timezone,
    service: {
      id: service.id,
      durationMin: service.duration_min,
      leadTimeHours: service.lead_time_hours,
      bookingHorizonDays: service.booking_horizon_days,
    },
    providers: [{
      id: provider.id,
      bufferBeforeMin: provider.buffer_before_min,
      bufferAfterMin: provider.buffer_after_min,
    }],
    rules, overrides, existingBookings, now,
  })

  const targetIso = startUtc.toISOString()
  const offered = slots.some((s) => s.startUtc === targetIso && s.providerIds.includes(providerId))
  return offered ? { ok: true } : { ok: false, reason: 'unavailable' }
}
