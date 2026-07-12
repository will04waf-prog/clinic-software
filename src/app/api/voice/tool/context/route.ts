/**
 * POST /api/voice/tool/context — Phase 5 W1.
 *
 * First tool Vapi calls after picking up an inbound call. Returns
 * the org's static context the LLM needs to ground its replies:
 *   - clinic name + timezone
 *   - greeting (custom or default)
 *   - service catalog (name, duration, ~price hint, description) so
 *     the LLM can answer "do you do X?" with a deterministic
 *     lookup rather than free-form invention
 *   - fallback phone number for the safety-handoff branch
 *
 * Org is resolved by the call's `to_e164` (the clinic's Twilio
 * number from organizations.twilio_phone_number). Never accepts
 * an org id from the client — that would let a forged Vapi call
 * leak any org's catalog.
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { verifyVapiSignature } from '@/lib/voice-agent/verify-vapi-signature'
import { resolveCallEnvelope } from '@/lib/voice-agent/resolve-envelope'
import { toolCallFromVapiPayload, toolCallResponseForVapi } from '@/lib/voice-agent/tool-types'
import { normalizePhone } from '@/lib/validators'

export async function POST(req: Request) {
  if (!verifyVapiSignature(req)) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const tc = toolCallFromVapiPayload(body)
  if (!tc) {
    return NextResponse.json({ error: 'unrecognized_payload_shape' }, { status: 400 })
  }

  // We allow the args to override the to_e164 the payload extractor
  // pulled, so a debug call from the Vapi dashboard can pass a number
  // in via the function args. Production calls put it in the call
  // envelope.
  // Identity hard-locked to call envelope in prod; LLM-supplied
  // to_e164/from_e164/phone_number args refused outside dev.
  const { toE164 } = await resolveCallEnvelope(tc)
  if (!toE164) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: false,
      error: 'Missing or unparseable to_e164',
    }))
  }

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select(`
      id, name, slug, timezone,
      call_agent_enabled, call_agent_mode, call_agent_fallback_e164,
      call_agent_greeting, call_agent_business_hours,
      call_agent_baa_attested_at
    `)
    .eq('twilio_phone_number', toE164)
    .maybeSingle()

  if (!org) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: false,
      error: 'No business mapped to this number',
    }))
  }
  if (!org.call_agent_enabled || !org.call_agent_baa_attested_at) {
    // The webhook should have already forwarded to fallback before
    // reaching us, but be defensive — refuse to leak context for an
    // org that hasn't enabled the agent.
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: false,
      error: 'Voice agent is not enabled for this business',
    }))
  }

  const { data: services } = await supabaseAdmin
    .from('services')
    .select('id, name, description, duration_min, price_cents')
    .eq('organization_id', org.id)
    .eq('is_active', true)
    .eq('is_bookable_online', true)
    .order('position', { ascending: true })

  const output = {
    clinic: {
      id:        org.id,
      slug:      org.slug,
      name:      org.name,
      timezone:  org.timezone,
      greeting:  org.call_agent_greeting,
      // Business hours are clinic-local HH:MM strings keyed by
      // weekday (0=Sun..6=Sat). The LLM should NOT compute "are we
      // open now" from these — the Twilio webhook already routed
      // based on after_hours mode. We surface them so the agent
      // can answer "what are your hours" without inventing.
      business_hours: org.call_agent_business_hours ?? null,
    },
    // Plain catalog the LLM uses for FAQ. We strip is_bookable_online
    // services from the response since those won't be schedulable
    // through the agent anyway.
    services: (services ?? []).map(s => ({
      id:          s.id,
      name:        s.name,
      description: s.description,
      duration_min: s.duration_min,
      // Price is a soft hint — the agent's system prompt forbids
      // quoting exact prices over the phone (matches the SMS
      // guardrail), so this is for context only.
      price_cents:  s.price_cents,
    })),
    // Owner's personal fallback cell stays server-side. transfer-to-human
    // reads it via its own server-side org lookup; the LLM only needs
    // to know whether transfer is possible, not the actual number.
    transfer_available: Boolean(org.call_agent_fallback_e164),
  }
  return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, { ok: true, output }))
}
