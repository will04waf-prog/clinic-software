/**
 * Pure aggregation for the "Layla's impact" ROI numbers. Extracted
 * from /api/dashboard/analytics so the weekly owner digest reports
 * EXACTLY the numbers the dashboard shows — one source of math, two
 * surfaces. No I/O here: callers fetch the rows (org-scoped!) and
 * pass them in.
 *
 * Attribution honesty (same as the dashboard): booked_via is always
 * 'public_page' (voice + web share it), so Layla vs web bookings
 * can't be split at the source. We report total booked value AND the
 * subset booked by patients Layla actually spoke with (an inbound
 * call in range) as separate, separately-labeled numbers.
 */

export interface ConsultRowForImpact {
  contact_id: string | null
  status: string
  // Supabase nested select comes back object-or-array depending on
  // the relationship; svcPrice() tolerates both.
  service?: unknown
}

export interface CallRowForImpact {
  direction: string
  outcome: string | null
  contact_id: string | null
}

export interface LaylaImpactAgg {
  callsAnswered: number
  reminderCallsPlaced: number
  messagesCaptured: number
  transferredToStaff: number
  bookingsInRange: number
  bookingRevenueCents: number
  laylaAssistedBookings: number
  laylaAssistedRevenueCents: number
  noShowRate: number | null
  callOutcomes: { outcome: string; count: number }[]
}

export function svcPrice(row: { service?: unknown }): number {
  const s = Array.isArray(row.service) ? row.service[0] : row.service
  return (s as { price_cents?: number } | null)?.price_cents ?? 0
}

export function aggregateLaylaImpact(
  consults: ConsultRowForImpact[],
  calls: CallRowForImpact[],
): LaylaImpactAgg {
  const inboundCalls = calls.filter((c) => c.direction === 'inbound')
  const outboundCalls = calls.filter((c) => c.direction === 'outbound')

  const outcomeMap = new Map<string, number>()
  for (const c of inboundCalls) {
    const o = c.outcome ?? 'completed'
    outcomeMap.set(o, (outcomeMap.get(o) ?? 0) + 1)
  }
  const callOutcomes = Array.from(outcomeMap, ([outcome, count]) => ({ outcome, count }))
    .sort((a, b) => b.count - a.count)

  const activeConsults = consults.filter((c) => c.status !== 'canceled')
  const inboundContactIds = new Set(
    inboundCalls.map((c) => c.contact_id).filter(Boolean) as string[],
  )
  const laylaAssisted = activeConsults.filter((c) => c.contact_id && inboundContactIds.has(c.contact_id))

  const completedCount = consults.filter((c) => c.status === 'completed').length
  const noShowCount = consults.filter((c) => c.status === 'no_show').length
  const noShowDenom = completedCount + noShowCount

  return {
    callsAnswered:             inboundCalls.length,
    reminderCallsPlaced:       outboundCalls.length,
    messagesCaptured:          inboundCalls.filter((c) => c.outcome === 'voicemail').length,
    transferredToStaff:        inboundCalls.filter((c) => c.outcome === 'transferred').length,
    bookingsInRange:           activeConsults.length,
    bookingRevenueCents:       activeConsults.reduce((sum, c) => sum + svcPrice(c), 0),
    laylaAssistedBookings:     laylaAssisted.length,
    laylaAssistedRevenueCents: laylaAssisted.reduce((sum, c) => sum + svcPrice(c), 0),
    noShowRate:                noShowDenom > 0 ? noShowCount / noShowDenom : null,
    callOutcomes,
  }
}
