import { NextRequest, NextResponse } from 'next/server'
import { consume, ipFor, CONFIRM_LIMIT } from '@/lib/booking/public-rate-limit'
import { confirmBookingInternal, type ConfirmReason } from '@/lib/booking/confirm-impl'

/**
 * POST /api/booking/confirm — Phase 4 W2 / Phase 5 refactor.
 *
 * Promotes a status='hold' consultation to status='scheduled' atomically:
 *   UPDATE consultations
 *     SET status='scheduled', hold_token=null, held_until=null
 *     WHERE id=$1 AND hold_token=$2 AND status='hold' AND held_until > now()
 *     RETURNING id
 *
 * Zero rows returned = the hold expired, was already confirmed, was
 * canceled by the cron, or the token doesn't match → 410 Gone with a
 * patient-friendly message. The patient is invited back to pick again.
 *
 * No new row is created here — the row already exists from /hold.
 * This means the EXCLUDE constraint that protected the slot during
 * the hold continues to protect it after confirmation. No race here.
 *
 * Like /api/booking/hold, this route is now a thin HTTP boundary
 * around confirmBookingInternal() (lib/booking/confirm-impl.ts). The
 * impl does the UPDATE + activity-log + manage-token + after()-
 * scheduled SMS / owner-email / automation work; both this route and
 * /api/voice/tool/confirm call it. Voice skips the per-IP rate limit
 * (every Vapi caller shares one egress IP → would 429 the fleet);
 * this route still runs it.
 */

function reasonToHttp(reason: ConfirmReason, message?: string): { status: number; body: { error: string; message?: string } } {
  switch (reason) {
    case 'invalid_args':
      return { status: 400, body: { error: 'invalid_input', message } }
    case 'hold_expired_or_invalid':
      return {
        status: 410,
        body: {
          error: 'hold_expired_or_invalid',
          message: 'This hold has expired or the token is invalid. Please pick a slot again.',
        },
      }
    case 'confirm_failed':
      return { status: 500, body: { error: 'confirm_failed', message } }
  }
}

export async function POST(req: NextRequest) {
  const ip = ipFor(req)
  const rl = consume(ip, CONFIRM_LIMIT)
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

  const result = await confirmBookingInternal(rawBody)
  if (!result.ok) {
    const { status, body } = reasonToHttp(result.reason, result.message)
    return NextResponse.json(body, { status })
  }

  return NextResponse.json({
    ok: true,
    consultation_id: result.consultation_id,
    scheduled_at:    result.scheduled_at,
    duration_min:    result.duration_min,
  })
}
