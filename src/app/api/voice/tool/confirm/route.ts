/**
 * POST /api/voice/tool/confirm — Phase 5 W1.
 *
 * Vapi calls this once the caller has explicitly agreed to the
 * hold ("yes, book me for Tuesday at 2"). Forwards to the existing
 * /api/booking/confirm which:
 *   - flips the consultations row from 'hold' → 'scheduled'
 *   - fires the patient confirmation SMS via after() (W4) — which
 *     includes the /manage/[token] link the caller can use to
 *     reschedule/cancel later
 *   - notifies the owner via email
 *
 * The agent's job is done after this returns ok — the patient will
 * receive the SMS with the manage link within ~30 seconds.
 */

import { NextResponse } from 'next/server'
import { verifyVapiSignature } from '@/lib/voice-agent/verify-vapi-signature'
import { getAppUrl } from '@/lib/voice-agent/app-url'
import { toolCallFromVapiPayload, toolCallResponseForVapi } from '@/lib/voice-agent/tool-types'


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
      ok: false,
      error: 'Missing consultation_id or hold_token (must come from the /tool/hold response).',
    }))
  }

  const res = await fetch(`${getAppUrl()}/api/booking/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      consultation_id: args.consultation_id,
      hold_token:      args.hold_token,
    }),
  })
  const json = await res.json().catch(() => ({}))

  if (!res.ok) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: false,
      error: json.message || json.error || `confirm_failed (${res.status})`,
    }))
  }

  return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
    ok: true,
    output: {
      consultation_id: json.consultation_id,
      scheduled_at:    json.scheduled_at,
      duration_min:    json.duration_min,
      // The agent should read this back so the caller hears
      // confirmation while still on the line — even before the SMS
      // arrives. e.g. "You're confirmed for Tuesday at 2pm. I just
      // texted you a link to manage the booking."
    },
  }))
}
