/**
 * POST /api/voice/tool/pre-visit-instructions — Phase 5 W2.
 *
 * Returns the service-specific pre-visit prep text (e.g. "no
 * retinol 48h before microneedling", "shave the area for laser")
 * for Layla to read aloud after a booking. Owner-authored, so
 * there's no LLM-generated clinical guidance risk. Service-generic
 * (not patient-specific) → no PHI in or out.
 *
 * Identity model: standard voice-tool gates. The org is resolved
 * from the Twilio `to` (clinic's number) and BAA attestation is
 * required. Service is re-validated server-side against the
 * resolved org + is_active so the LLM can't pull prep text out of
 * a different clinic by passing a sibling service_id.
 *
 * When the service has no prep text, returns ok:true with
 * has_instructions:false so the LLM can fall back gracefully
 * ("no special prep needed for this one — see you Tuesday").
 *
 * Optional pairing: the LLM may follow up with `send_link_sms`
 * (link_kind='manage') so the patient also gets the prep in
 * writing. This route itself does NOT send SMS — that lives in
 * the dedicated SMS tool so consent/opt-out/log discipline stays
 * in one place.
 */

import { NextResponse, after } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { verifyVapiSignature } from '@/lib/voice-agent/verify-vapi-signature'
import { resolveCallEnvelope } from '@/lib/voice-agent/resolve-envelope'
import { toolCallFromVapiPayload, toolCallResponseForVapi } from '@/lib/voice-agent/tool-types'
import { normalizePhone } from '@/lib/validators'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: Request) {
  if (!verifyVapiSignature(req)) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const tc = toolCallFromVapiPayload(body)
  if (!tc) {
    return NextResponse.json({ error: 'unrecognized_payload_shape' }, { status: 400 })
  }

  // ---- Validate caller-supplied inputs at the top --------------
  // service_id is LLM-supplied (typically from find_service /
  // get_context). UUID-shape check keeps malformed args from
  // making it to the DB.
  const rawServiceId = tc.arguments.service_id
  if (typeof rawServiceId !== 'string' || !UUID_RE.test(rawServiceId)) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: false,
      error: 'Missing or invalid service_id',
    }))
  }
  const serviceId = rawServiceId

  // Args overrides for dashboard test calls — same pattern as
  // every other voice tool. Production reads tc.toE164 from the
  // Vapi call envelope.
  // Identity hard-locked to call envelope in prod; LLM-supplied
  // to_e164/from_e164/phone_number args refused outside dev.
  const { toE164 } = resolveCallEnvelope(tc)
  if (!toE164) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: false,
      error: 'Missing or unparseable to_e164',
    }))
  }

  // ---- Org resolution + BAA gate ------------------------------
  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('id, call_agent_enabled, call_agent_baa_attested_at')
    .eq('twilio_phone_number', toE164)
    .maybeSingle()
  if (!org) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: false,
      error: 'No clinic mapped to this number',
    }))
  }
  if (!org.call_agent_enabled || !org.call_agent_baa_attested_at) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: false,
      error: 'Voice agent is not enabled for this clinic',
    }))
  }

  // ---- Read service, scoped to org + active -------------------
  // .eq('organization_id', org.id) is what stops cross-tenant
  // reads under supabaseAdmin (which bypasses RLS).
  const { data: service, error: svcErr } = await supabaseAdmin
    .from('services')
    .select('id, name, pre_visit_instructions')
    .eq('id', serviceId)
    .eq('organization_id', org.id)
    .eq('is_active', true)
    .maybeSingle()
  if (svcErr) {
    console.error('[voice/tool/pre-visit-instructions] svc lookup failed', { err: svcErr.message })
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: false,
      error: 'Could not load service',
    }))
  }
  if (!service) {
    // Not found OR not in this org OR inactive — collapse to the
    // same soft response so the LLM doesn't try to probe.
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: true,
      output: { has_instructions: false, reason: 'service_not_found_or_inactive' },
    }))
  }

  const prep = (service.pre_visit_instructions ?? '').trim()
  if (!prep) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: true,
      output: {
        has_instructions: false,
        service_id:       service.id,
        service_name:     service.name,
      },
    }))
  }

  // ---- Analytics: log that Layla spoke the prep (non-critical)
  after(async () => {
    try {
      await supabaseAdmin.from('activity_log').insert({
        organization_id: org.id,
        action:          'voice_prep_spoken',
        metadata: {
          service_id: service.id,
          call_sid:   tc.callSid ?? null,
        },
      })
    } catch (err) {
      console.error('[voice/tool/pre-visit-instructions] activity_log insert failed', err)
    }
  })

  return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
    ok: true,
    output: {
      has_instructions: true,
      service_id:       service.id,
      service_name:     service.name,
      instructions:     prep,
    },
  }))
}
