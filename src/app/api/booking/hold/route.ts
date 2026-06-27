import { NextRequest, NextResponse } from 'next/server'
import { consume, ipFor, HOLD_LIMIT } from '@/lib/booking/public-rate-limit'
import { holdBookingInternal, type HoldReason } from '@/lib/booking/hold-impl'

/**
 * POST /api/booking/hold — Phase 4 W2 / Phase 5 refactor.
 *
 * Anonymous endpoint that creates (or reuses) a contact by phone
 * within the org and inserts a consultations row with status='hold'
 * that occupies the requested slot for HOLD_TTL_MINUTES. Returns a
 * hold_token the patient sends back to /api/booking/confirm.
 *
 * This route is now a thin HTTP boundary around holdBookingInternal()
 * (lib/booking/hold-impl.ts). The split exists because the voice
 * receptionist tool /api/voice/tool/hold needs to do the same booking
 * work WITHOUT going through the per-IP rate limit (every Vapi call
 * shares one egress IP — the public limit would 429 the whole voice
 * fleet under load). The voice route calls the impl directly; this
 * route additionally runs ipFor + consume() before delegating.
 *
 * Race prevention is the W1 EXCLUDE constraint
 * (consultations_no_provider_overlap). Two patients clicking the
 * same slot at the same instant both try to insert at status='hold'
 * — exactly one wins; the other gets 23P01 → impl returns
 * { ok:false, reason:'slot_taken' } → mapped to HTTP 409 here.
 *
 * Abandoned holds are NOT a waste: the contact row stays in the
 * clinic's CRM with source='public_booking' so the clinic can follow
 * up. The hold itself sweeps to status='canceled' on the next cron.
 */

/**
 * Map the impl's structured reason enum onto HTTP status codes +
 * patient-friendly messages. Kept here (rather than in hold-impl)
 * because messaging is a UI concern that varies by surface — the
 * voice tool returns the same `reason` to the LLM with no message,
 * so the LLM can branch instead of parsing English.
 */
function reasonToHttp(reason: HoldReason, message?: string): { status: number; body: { error: string; message?: string } } {
  switch (reason) {
    case 'invalid_args':
      return { status: 400, body: { error: 'invalid_input', message } }
    case 'invalid_slot':
      return { status: 400, body: { error: 'invalid_slot' } }
    case 'slot_in_past':
      return { status: 400, body: { error: 'slot_in_past' } }
    case 'not_found':
      return { status: 404, body: { error: 'not_found' } }
    case 'booking_disabled':
      return { status: 403, body: { error: 'booking_disabled' } }
    case 'service_not_bookable':
      return { status: 404, body: { error: 'service_not_bookable' } }
    case 'provider_not_available':
      return { status: 404, body: { error: 'provider_not_available' } }
    case 'provider_cannot_perform_service':
      return { status: 400, body: { error: 'provider_cannot_perform_service' } }
    case 'slot_taken':
      return {
        status: 409,
        body: {
          error: 'slot_unavailable',
          message: 'Slot was just taken — please pick another time.',
        },
      }
    case 'contact_create_failed':
      return { status: 500, body: { error: 'contact_create_failed', message } }
    case 'hold_failed':
      return { status: 500, body: { error: 'hold_failed', message } }
  }
}

export async function POST(req: NextRequest) {
  // ── Rate limit. Cheap and runs before any DB work. ──
  const ip = ipFor(req)
  const rl = consume(ip, HOLD_LIMIT)
  if (!rl.ok) {
    return NextResponse.json(
      {
        error: 'rate_limited',
        message: `Too many requests. Try again in ${rl.retryAfterSeconds}s.`,
      },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    )
  }

  let rawBody: unknown
  try { rawBody = await req.json() } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const result = await holdBookingInternal(rawBody)
  if (!result.ok) {
    const { status, body } = reasonToHttp(result.reason, result.message)
    return NextResponse.json(body, { status })
  }

  return NextResponse.json({
    consultation_id:    result.consultation_id,
    hold_token:         result.hold_token,
    expires_at:         result.expires_at,
    expires_in_seconds: result.expires_in_seconds,
  }, { status: 201 })
}
