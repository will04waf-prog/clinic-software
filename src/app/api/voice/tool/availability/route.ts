/**
 * POST /api/voice/tool/availability — Phase 5 W1.
 *
 * Called by Vapi when the LLM decides the caller wants to book
 * (`I'd like to come in for botox`, `do you have anything Thursday`).
 *
 * Reuses src/lib/ai-twin/booking-slots-for-twin.fetchSlotsForTwin
 * in-process — skipping the HTTP hop saves ~50-150ms vs calling
 * /api/booking/public/[slug]/availability, which matters because
 * Vapi's tool timeout is ~5 seconds and the availability query
 * cold-starts at 1-2s on its own. The SMS twin already runs this
 * helper so we get parity for free.
 *
 * Returns 1-2 slots only (voice budget — the agent will read them
 * aloud, more than 2 sounds like a list). Service is resolved by
 * name match against the org's catalog.
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { verifyVapiSignature } from '@/lib/voice-agent/verify-vapi-signature'
import { toolCallFromVapiPayload, toolCallResponseForVapi } from '@/lib/voice-agent/tool-types'
import { fetchSlotsForTwin } from '@/lib/ai-twin/booking-slots-for-twin'
import { normalizePhone } from '@/lib/validators'

export async function POST(req: Request) {
  if (!verifyVapiSignature(req)) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const tc = toolCallFromVapiPayload(body)
  if (!tc) return NextResponse.json({ error: 'unrecognized_payload_shape' }, { status: 400 })

  const argsToE164 = typeof tc.arguments.to_e164 === 'string' ? tc.arguments.to_e164 : undefined
  const toE164 = normalizePhone(argsToE164 ?? tc.toE164 ?? '')
  const serviceHintArg = typeof tc.arguments.service === 'string'
    ? tc.arguments.service
    : null

  if (!toE164) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: false,
      error: 'Missing or unparseable to_e164',
    }))
  }

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('id, slug, call_agent_enabled, call_agent_baa_attested_at')
    .eq('twilio_phone_number', toE164)
    .maybeSingle()

  if (!org || !org.call_agent_enabled || !org.call_agent_baa_attested_at) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: false,
      error: 'Voice agent is not enabled for this clinic',
    }))
  }

  // fetchSlotsForTwin returns up to MAX_SLOTS_RETURNED (=2). Reuses
  // booking_enabled + slug + active providers + buffers + window
  // logic from the SMS twin — single source of truth.
  const suggestion = await fetchSlotsForTwin({
    organizationId: org.id,
    serviceHint:    serviceHintArg,
    messageClass:   'faq',
  })

  if (suggestion.kind === 'none') {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: true,
      output: { kind: 'none', reason: suggestion.reason },
    }))
  }
  if (suggestion.kind === 'fully_booked') {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: true,
      output: {
        kind: 'fully_booked',
        service: suggestion.service,
        booking_url: suggestion.bookingUrl,
      },
    }))
  }
  // kind === 'slots'
  return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
    ok: true,
    output: {
      kind:        'slots',
      service:     suggestion.service,
      // Plain spoken-language strings the agent reads aloud
      // verbatim. Includes day-of-week + clock time in clinic tz.
      slots:       suggestion.slots.map(s => ({
        start_utc:   s.startUtc,
        end_utc:     s.endUtc,
        spoken:      s.label,
        provider_id: s.providerId,
      })),
      booking_url: suggestion.bookingUrl,
    },
  }))
}
