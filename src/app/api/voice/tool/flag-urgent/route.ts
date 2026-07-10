/**
 * POST /api/voice/tool/flag-urgent — Multi-vertical Phase 4.
 *
 * Layla (trades assistants only) calls this the moment a caller
 * describes a business emergency — burst pipe, no water, gas smell,
 * flooding. It:
 *   1. Marks the call urgent in the CRM (a voice_urgent_flag
 *      activity_log row; the call-end webhook copies it onto
 *      call_logs.is_urgent + urgency_reason).
 *   2. Fires an IMMEDIATE owner alert on their channel — carrying the
 *      caller's number + stated issue for one-tap callback — that
 *      bypasses ALL dedupe/digest logic and never goes silent (falls
 *      back to email if the phone channels can't deliver).
 *
 * This is NOT the medical 911 rail — that safety line lives in the
 * base prompt, fires first, and is never intercepted here. flag_urgent
 * is a business-emergency escalation only, and only trades assistants
 * carry the tool (seed-assistants gates it), so the caller number in
 * the alert is not PHI.
 */

import { NextResponse, after } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { verifyVapiSignature } from '@/lib/voice-agent/verify-vapi-signature'
import { resolveCallEnvelope } from '@/lib/voice-agent/resolve-envelope'
import { toolCallFromVapiPayload, toolCallResponseForVapi } from '@/lib/voice-agent/tool-types'
import { alertOwnerUrgent } from '@/lib/notify/urgent'

export async function POST(req: Request) {
  if (!verifyVapiSignature(req)) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const tc = toolCallFromVapiPayload(body)
  if (!tc) {
    return NextResponse.json({ error: 'unrecognized_payload_shape' }, { status: 400 })
  }

  const { toE164, fromE164 } = await resolveCallEnvelope(tc)
  if (!toE164) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: false,
      error: 'Missing or unparseable to_e164',
    }))
  }

  const reasonRaw = tc.arguments.reason
  if (typeof reasonRaw !== 'string' || !reasonRaw.trim()) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: false,
      error: 'reason is required',
    }))
  }
  const reason = reasonRaw.trim().slice(0, 200)

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('id, name, owner_language, call_agent_enabled, call_agent_baa_attested_at')
    .eq('twilio_phone_number', toE164)
    .maybeSingle()
  if (!org) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: false,
      error: 'No business mapped to this number',
    }))
  }
  if (!org.call_agent_enabled || !org.call_agent_baa_attested_at) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: false,
      error: 'Voice agent is not enabled',
    }))
  }

  // Durable CRM mark — persisted synchronously so the call-end webhook
  // can copy is_urgent onto call_logs even if the alert send is slow.
  const callSid = tc.callSid ?? ''
  await supabaseAdmin.from('activity_log').insert({
    organization_id: org.id,
    action:          'voice_urgent_flag',
    metadata: {
      call_sid:     callSid,
      reason,
      caller_phone: fromE164 ?? null,
    },
  })

  // Immediate, dedupe-free owner alert. after() so Layla's tool call
  // returns instantly and she keeps talking to the caller.
  const ownerLanguage: 'en' | 'es' = org.owner_language === 'es' ? 'es' : 'en'
  const callerPhone = fromE164 ?? (ownerLanguage === 'es' ? 'número no disponible' : 'number unavailable')
  after(async () => {
    try {
      await alertOwnerUrgent({
        organizationId: org.id,
        orgName:        org.name,
        ownerLanguage,
        callerPhone,
        issue:          reason,
      })
    } catch (err) {
      console.error('[voice/tool/flag-urgent] alert threw', err)
    }
  })

  return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
    ok: true,
    output: { flagged: true },
  }))
}
