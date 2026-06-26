/**
 * POST /api/voice/tool/my-appointments — Phase 5 W1.
 *
 * Looks up the caller's upcoming consultations by caller ID. Used by
 * Layla when a caller asks "do I have an appointment with you?" The
 * org is resolved from the Twilio `to` (clinic's number) and the
 * caller from the Twilio `from` — both come out of Vapi's call
 * envelope, so the tool itself takes no arguments.
 *
 * Identity model: caller-ID match is the same proof a human
 * receptionist uses ("is this Sarah, calling from this number?").
 * Spoofing exists, but the disclosure is read at call start and the
 * patient already trusted us with this number when they booked. We
 * scope to FUTURE appointments only — never historic — so a leak
 * would expose, at most, the existence of a single upcoming
 * consultation tied to that exact number.
 *
 * Returns at most 2 upcoming consultations to keep the spoken
 * response short. The strings in `output.spoken` are intended for
 * the LLM to read back verbatim.
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { verifyVapiSignature } from '@/lib/voice-agent/verify-vapi-signature'
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

  // Allow args overrides for dashboard test calls (same pattern as
  // /tool/context). Production calls populate these from the call
  // envelope automatically.
  const argsToE164   = typeof tc.arguments.to_e164   === 'string' ? tc.arguments.to_e164   : undefined
  const argsFromE164 = typeof tc.arguments.from_e164 === 'string' ? tc.arguments.from_e164 : undefined
  const toE164   = normalizePhone(argsToE164   ?? tc.toE164   ?? '')
  const fromE164 = normalizePhone(argsFromE164 ?? tc.fromE164 ?? '')
  if (!toE164) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: false,
      error: 'Missing or unparseable to_e164',
    }))
  }
  if (!fromE164) {
    // No caller ID → we can't identify them. The LLM should fall back
    // to "I'd need to look that up — what's the best number on the
    // booking?" (handled in the prompt).
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: true,
      output: { found: false, reason: 'no_caller_id' },
    }))
  }

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('id, timezone, call_agent_enabled, call_agent_baa_attested_at')
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

  // Resolve contact by last-10 of from_e164 — same pattern as
  // persistCallLog. ilike + JS exact-compare on the trailing 10
  // digits. Bail-out if we can't compute a clean last-10.
  const last10 = (fromE164 ?? '').replace(/\D/g, '').slice(-10)
  if (last10.length !== 10) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: true,
      output: { found: false, reason: 'unparseable_caller_id' },
    }))
  }
  const { data: candidates } = await supabaseAdmin
    .from('contacts')
    .select('id, first_name, phone')
    .eq('organization_id', org.id)
    .eq('is_archived', false)
    .ilike('phone', `%${last10}`)
    .limit(5)
  const contact = (candidates ?? []).find(
    c => (c.phone ?? '').replace(/\D/g, '').slice(-10) === last10,
  )
  if (!contact) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: true,
      output: { found: false, reason: 'no_contact_for_caller_id' },
    }))
  }

  const nowIso = new Date().toISOString()
  const { data: consultations } = await supabaseAdmin
    .from('consultations')
    .select('id, scheduled_at, status, services!consultations_service_id_fkey(name)')
    .eq('organization_id', org.id)
    .eq('contact_id', contact.id)
    .in('status', ['scheduled', 'confirmed'])
    .gt('scheduled_at', nowIso)
    .order('scheduled_at', { ascending: true })
    .limit(2)

  if (!consultations || consultations.length === 0) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: true,
      output: { found: false, reason: 'no_upcoming', contact_first_name: contact.first_name ?? null },
    }))
  }

  // Format a spoken phrase per consultation. Format in the clinic's
  // timezone so "Tuesday at 2 PM" lines up with what the patient
  // expects locally rather than UTC.
  const tz = org.timezone || 'America/New_York'
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday:  'long',
    month:    'long',
    day:      'numeric',
    hour:     'numeric',
    minute:   '2-digit',
    hour12:   true,
  })

  const appointments = consultations.map(c => {
    // Supabase typegen gives the relation as either an array or a
    // single object depending on FK shape. Normalize.
    const svc = Array.isArray(c.services) ? c.services[0] : c.services
    const spoken = fmt.format(new Date(c.scheduled_at))
    return {
      consultation_id: c.id,
      scheduled_at:    c.scheduled_at,
      status:          c.status,
      service_name:    svc?.name ?? 'your appointment',
      spoken,
    }
  })

  return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
    ok: true,
    output: {
      found:               true,
      contact_first_name:  contact.first_name ?? null,
      appointments,
    },
  }))
}
