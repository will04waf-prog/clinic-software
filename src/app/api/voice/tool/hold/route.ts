/**
 * POST /api/voice/tool/hold — Phase 5 W1.
 *
 * Vapi calls this when the caller has agreed to a specific slot
 * surfaced by /tool/availability. We forward to the existing public
 * /api/booking/hold which:
 *   - rate-limits per IP
 *   - dedupes contact by phone (W4 add-on email match)
 *   - sets sms_consent=true (verbal consent captured by the agent)
 *   - inserts a consultations row at status='hold' with a 10-minute
 *     held_until TTL
 *
 * Verbal smsConsent: the agent's system prompt requires it to say
 * something like "I'll send you a confirmation by text — is that
 * OK?" before calling this tool. If the caller refuses, the agent
 * MUST NOT invoke this tool (we pass smsConsent=true unconditionally,
 * so the system-prompt rule is the gate; defense-in-depth comment).
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { verifyVapiSignature } from '@/lib/voice-agent/verify-vapi-signature'
import { toolCallFromVapiPayload, toolCallResponseForVapi } from '@/lib/voice-agent/tool-types'
import { normalizePhone } from '@/lib/validators'

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://tarhunna.net').replace(/\/$/, '')

export async function POST(req: Request) {
  if (!verifyVapiSignature(req)) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const tc = toolCallFromVapiPayload(body)
  if (!tc) return NextResponse.json({ error: 'unrecognized_payload_shape' }, { status: 400 })

  // Required args from the agent.
  const args = tc.arguments as {
    to_e164?:     string
    service_id?:  string
    provider_id?: string
    slot_start_utc?: string
    name?:        string
    phone?:       string
    email?:       string
    notes?:       string
  }

  const toE164 = normalizePhone(args.to_e164 ?? tc.toE164 ?? '')
  if (!toE164 || !args.service_id || !args.provider_id || !args.slot_start_utc || !args.name || !args.phone) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: false,
      error: 'Missing one of: to_e164, service_id, provider_id, slot_start_utc, name, phone.',
    }))
  }

  // Resolve org from to_e164 so we know the slug for the public
  // booking endpoint. The hold route itself re-validates the slug,
  // but we need to translate the Twilio number to the slug here.
  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('slug, call_agent_enabled, call_agent_baa_attested_at')
    .eq('twilio_phone_number', toE164)
    .maybeSingle()
  if (!org || !org.call_agent_enabled || !org.call_agent_baa_attested_at) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: false,
      error: 'Voice agent is not enabled for this clinic',
    }))
  }

  // Forward to the existing public /api/booking/hold. Calling the
  // route over HTTP (vs lifting the handler into a shared function)
  // keeps the rate-limit + race-safe insert behavior intact — the
  // EXCLUDE constraint on the consultations table handles
  // double-bookings transparently.
  const holdRes = await fetch(`${APP_URL}/api/booking/hold`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      orgSlug:      org.slug,
      serviceId:    args.service_id,
      providerId:   args.provider_id,
      slotStartUtc: args.slot_start_utc,
      name:         args.name,
      phone:        args.phone,
      email:        args.email || undefined,
      smsConsent:   true,
      notes:        args.notes || undefined,
    }),
  })
  const holdJson = await holdRes.json().catch(() => ({}))

  if (!holdRes.ok) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: false,
      // Surface the booking endpoint's user-facing message verbatim
      // so the agent can read it back ("that slot was just taken").
      error: holdJson.message || holdJson.error || `hold_failed (${holdRes.status})`,
    }))
  }

  return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
    ok: true,
    output: {
      consultation_id: holdJson.consultation_id,
      hold_token:      holdJson.hold_token,
      held_until:      holdJson.held_until,
    },
  }))
}
