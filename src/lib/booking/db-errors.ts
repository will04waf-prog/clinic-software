/**
 * Postgres error → HTTP response mapping for the booking surface.
 *
 * The consultations table's EXCLUDE constraint
 * (consultations_no_provider_overlap) raises SQLSTATE 23P01 when two
 * rows would overlap on (provider_id, time_range) inside one of the
 * active states (hold|scheduled|confirmed). That fires when two
 * patients race for the same slot. The losing INSERT must surface as
 * an HTTP 409 with a patient-friendly message — never as a 500 with a
 * raw constraint name leaked into the response.
 *
 * This helper centralizes the recognition + translation so every
 * write path (W2 hold endpoint, W2 confirm endpoint, the existing
 * /api/consultations POST that also accepts provider_id today) maps
 * the same error to the same response shape.
 */

import { NextResponse } from 'next/server'

interface MaybePgError {
  code?: string
  message?: string
  details?: string
  constraint?: string
}

const SLOT_CONFLICT_CONSTRAINT = 'consultations_no_provider_overlap'

/**
 * Returns a NextResponse for a known booking-layer error, or null if
 * the error is not one we recognize. Callers should fall through to
 * their own 500/log path on null.
 *
 * Today this only handles 23P01 (slot conflict) — kept narrow so
 * callers don't accidentally swallow real bugs.
 */
export function mapBookingError(err: unknown): NextResponse | null {
  if (!err || typeof err !== 'object') return null
  const e = err as MaybePgError
  if (e.code === '23P01' || (typeof e.constraint === 'string' && e.constraint === SLOT_CONFLICT_CONSTRAINT)) {
    return NextResponse.json(
      {
        error: 'slot_unavailable',
        message: 'Slot was just taken — please pick another time.',
      },
      { status: 409 },
    )
  }
  return null
}
