/**
 * POST /api/voice/tool/hold — Phase 5 W1 / Phase 5 hardening.
 *
 * Vapi calls this when the caller has agreed to a specific slot
 * surfaced by /tool/availability. We delegate to holdBookingInternal()
 * (lib/booking/hold-impl.ts) IN-PROCESS — not through an HTTP fetch
 * to /api/booking/hold. The earlier shape (this route fetched its
 * sibling over the network) had two problems:
 *
 *   1. Every Vapi-originated request inherits Vapi's egress IP, so
 *      the per-IP rate limit on /api/booking/hold bucketed every
 *      voice caller in the fleet together — a few simultaneous voice
 *      bookings would 429 each other.
 *
 *   2. The fetch() itself could throw (DNS / network blip) and we
 *      didn't catch it, so a transient infra issue showed up to the
 *      caller as a stack-trace 500 instead of a "let me try again"
 *      reply.
 *
 * Lifting the impl in-process closes both. Voice is already gated
 * upstream (Vapi assistant minutes + the caller is on the line) so
 * skipping the per-IP limit here is the right call.
 *
 * Result shape is structured {booked:false, reason:'slot_taken' | ...}
 * matching reschedule_appointment's contract so the LLM can branch
 * on reason instead of parsing English error strings.
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
import { resolveCallEnvelope } from '@/lib/voice-agent/resolve-envelope'
import { toolCallFromVapiPayload, toolCallResponseForVapi } from '@/lib/voice-agent/tool-types'
import { normalizePhone } from '@/lib/validators'
import { holdBookingInternal } from '@/lib/booking/hold-impl'


export async function POST(req: Request) {
  if (!verifyVapiSignature(req)) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const tc = toolCallFromVapiPayload(body)
  if (!tc) return NextResponse.json({ error: 'unrecognized_payload_shape' }, { status: 400 })

  // Required args from the agent.
  const args = tc.arguments as {
    service_id?:  string
    provider_id?: string
    slot_start_utc?: string
    name?:        string
    phone?:       string
    email?:       string
    notes?:       string
  }

  // Envelope: to_e164/from_e164/phone_number args are ignored in prod
  // (caller-id spoof vector). resolveCallEnvelope is the single source
  // of truth — see lib/voice-agent/resolve-envelope.ts.
  const { toE164, fromE164 } = resolveCallEnvelope(tc)
  if (!toE164 || !args.service_id || !args.provider_id || !args.slot_start_utc || !args.name || !args.phone) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: true,
      output: {
        booked: false,
        reason: 'invalid_args',
      },
    }))
  }

  // Resolve org from to_e164. The hold impl can take orgId directly —
  // saves a redundant slug lookup that the public route has to do.
  // We also need call_agent_enabled + BAA attestation here: those
  // are voice-tool concerns the public /api/booking/hold doesn't gate
  // on.
  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('id, call_agent_enabled, call_agent_baa_attested_at')
    .eq('twilio_phone_number', toE164)
    .maybeSingle()
  if (!org || !org.call_agent_enabled || !org.call_agent_baa_attested_at) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: true,
      output: {
        booked: false,
        reason: 'service_or_provider_missing',
      },
    }))
  }

  // Phone-redirect audit. If the agent passed a `phone` that differs
  // from the caller-ID `from_e164`, that's a legitimate use case (a
  // caller booking on behalf of a spouse/parent), but it ALSO means
  // the confirmation SMS goes to a different number than the call
  // came from. We don't block — but we DO log an activity_log entry
  // so the clinic can audit which bookings were made on behalf of
  // someone else, and so prompt-injection probes leave a trail.
  // last-4 only, never the full E.164 (matches the cancel/reschedule
  // logging convention).
  const argPhoneNormalized = normalizePhone(args.phone)
  if (argPhoneNormalized && fromE164 && argPhoneNormalized !== fromE164) {
    try {
      await supabaseAdmin.from('activity_log').insert({
        organization_id: org.id,
        action: 'phone_redirect_to_third_party',
        metadata: {
          tool:             'create_hold',
          call_sid:         tc.callSid ?? null,
          from_e164_tail:   fromE164.slice(-4),
          target_e164_tail: argPhoneNormalized.slice(-4),
        },
      })
    } catch {
      // Best-effort audit — never block the booking on a logging miss.
    }
  }

  const result = await holdBookingInternal({
    orgId:        org.id,
    serviceId:    args.service_id,
    providerId:   args.provider_id,
    slotStartUtc: args.slot_start_utc,
    name:         args.name,
    phone:        args.phone,
    email:        args.email || undefined,
    smsConsent:   true,
    notes:        args.notes || undefined,
  })

  if (!result.ok) {
    // Map every impl reason into the closed structured shape the
    // receptionist prompt branches on. The LLM never sees raw DB
    // errors — it sees 'slot_taken', 'invalid_args', or
    // 'service_or_provider_missing'.
    const reason: 'slot_taken' | 'invalid_args' | 'service_or_provider_missing' = (() => {
      switch (result.reason) {
        case 'slot_taken':
          return 'slot_taken'
        case 'invalid_args':
        case 'invalid_slot':
        case 'slot_in_past':
        case 'provider_cannot_perform_service':
          return 'invalid_args'
        case 'not_found':
        case 'booking_disabled':
        case 'service_not_bookable':
        case 'provider_not_available':
        case 'contact_create_failed':
        case 'hold_failed':
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
      hold_token:      result.hold_token,
      // Receptionist prompt expects `held_until` — the impl returns
      // `expires_at`. Same instant, renamed to match the prompt
      // vocabulary so Layla can read it back ("I'm holding this slot
      // until 2:13").
      held_until:      result.expires_at,
    },
  }))
}
