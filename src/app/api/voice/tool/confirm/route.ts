/**
 * POST /api/voice/tool/confirm — Phase 5 W1 / Phase 5 hardening.
 *
 * Vapi calls this once the caller has explicitly agreed to the hold
 * ("yes, book me for Tuesday at 2"). We delegate to
 * confirmBookingInternal() (lib/booking/confirm-impl.ts) IN-PROCESS —
 * not through an HTTP fetch to /api/booking/confirm. See the matching
 * comment in /api/voice/tool/hold/route.ts for the full reasoning; the
 * short version is:
 *
 *   1. /api/booking/confirm rate-limits per IP, and every Vapi caller
 *      shares one egress IP — the per-IP bucket would 429 the whole
 *      voice fleet under load.
 *   2. A fetch() between routes can throw on a DNS / network blip,
 *      surfacing as a stack-trace 500 to the caller instead of a
 *      "let me try again" reply.
 *
 * Lifting the impl in-process closes both. The impl handles:
 *   - the atomic UPDATE hold → scheduled
 *   - activity_log audit row
 *   - manage-token sign + /manage/[token] URL build via getAppUrl()
 *   - after()-scheduled patient SMS, owner email, automation enqueue
 *   - pipeline-stage move
 *
 * The agent's job is done after this returns booked:true — the
 * patient will receive the SMS with the manage link within ~30 seconds.
 *
 * Result shape is structured {booked:false, reason:'slot_taken' | ...}
 * matching create_hold's contract so the LLM can branch on reason.
 */

import { NextResponse } from 'next/server'
import { verifyVapiSignature } from '@/lib/voice-agent/verify-vapi-signature'
import { toolCallFromVapiPayload, toolCallResponseForVapi } from '@/lib/voice-agent/tool-types'
import { confirmBookingInternal, formatSpokenTime } from '@/lib/booking/confirm-impl'


export async function POST(req: Request) {
  if (!verifyVapiSignature(req)) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const tc = toolCallFromVapiPayload(body)
  if (!tc) return NextResponse.json({ error: 'unrecognized_payload_shape' }, { status: 400 })

  const args = tc.arguments as {
    consultation_id?: string
    hold_token?:      string
  }
  if (!args.consultation_id || !args.hold_token) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: true,
      output: {
        booked: false,
        reason: 'invalid_args',
      },
    }))
  }

  const result = await confirmBookingInternal({
    consultation_id: args.consultation_id,
    hold_token:      args.hold_token,
  })

  if (!result.ok) {
    // Map impl reasons onto the closed enum the receptionist prompt
    // branches on. 'hold_expired_or_invalid' surfaces as 'slot_taken'
    // — from the caller's perspective the slot effectively went away
    // (their hold expired or someone else confirmed first) and the
    // recovery is the same: offer the next available slot.
    const reason: 'slot_taken' | 'invalid_args' | 'service_or_provider_missing' = (() => {
      switch (result.reason) {
        case 'invalid_args':
          return 'invalid_args'
        case 'hold_expired_or_invalid':
          return 'slot_taken'
        case 'confirm_failed':
        default:
          return 'service_or_provider_missing'
      }
    })()
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: true,
      output: { booked: false, reason },
    }))
  }

  return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
    ok: true,
    output: {
      booked:          true,
      consultation_id: result.consultation_id,
      scheduled_at:    result.scheduled_at,
      duration_min:    result.duration_min,
      // Parity with my-appointments + (eventually) reschedule: give
      // the LLM a pre-formatted spoken phrase in the clinic timezone
      // so it reads back "Tuesday, March 18 at 2:00 PM" instead of
      // dictating raw ISO. The agent should read this back so the
      // caller hears confirmation while still on the line — even
      // before the SMS arrives.
      spoken:          formatSpokenTime(result.scheduled_at, result.timezone),
    },
  }))
}
