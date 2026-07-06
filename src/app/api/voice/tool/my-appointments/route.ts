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
import { resolveCallEnvelope } from '@/lib/voice-agent/resolve-envelope'
import { toolCallFromVapiPayload, toolCallResponseForVapi } from '@/lib/voice-agent/tool-types'

export async function POST(req: Request) {
  if (!verifyVapiSignature(req)) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const tc = toolCallFromVapiPayload(body)
  if (!tc) {
    return NextResponse.json({ error: 'unrecognized_payload_shape' }, { status: 400 })
  }

  // CRITICAL: identity (fromE164) MUST come from the Vapi call
  // envelope in production. Earlier versions accepted an LLM-supplied
  // `phone_number` arg as a fallback, which let a prompt-injecting
  // caller pivot to another patient's record. resolveCallEnvelope
  // refuses args in prod and only honors them in dev/test.
  const { toE164, fromE164 } = await resolveCallEnvelope(tc)
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
  // Exact-match on the trailing 10 digits — ilike '%<last10>' can
  // accidentally match a phone whose middle digits happen to contain
  // the same suffix (e.g. '15125551212' vs '5551212' on a country
  // code with the wrong split). The JS compare is the authoritative
  // check.
  const exactMatches = (candidates ?? []).filter(
    c => (c.phone ?? '').replace(/\D/g, '').slice(-10) === last10,
  )
  // Collision guard: two contacts in the same org with the same
  // trailing 10 digits is rare but real (data-entry duplicates,
  // shared family lines). Picking one arbitrarily would mis-identify
  // the caller — surface ambiguous_caller_id and let Layla fall back
  // to take_message rather than silently exposing someone else's
  // appointments.
  if (exactMatches.length > 1) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: true,
      output: { found: false, reason: 'ambiguous_caller_id' },
    }))
  }
  const contact = exactMatches[0]
  if (!contact) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: true,
      output: { found: false, reason: 'no_contact_for_caller_id' },
    }))
  }

  const nowIso = new Date().toISOString()
  const { data: consultations, error: consultErr } = await supabaseAdmin
    .from('consultations')
    .select('id, scheduled_at, status, services!consultations_service_id_fkey(name)')
    .eq('organization_id', org.id)
    .eq('contact_id', contact.id)
    .in('status', ['scheduled', 'confirmed'])
    .gt('scheduled_at', nowIso)
    .order('scheduled_at', { ascending: true })
    .limit(2)

  // Distinguish a DB error from a legitimate "no upcoming" — the
  // earlier code coalesced both into reason:'no_upcoming', telling
  // the caller they had no appointment when really the lookup
  // failed.
  if (consultErr) {
    console.error('[voice/my-appointments] consultations lookup failed', consultErr.message)
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: true,
      output: { found: false, reason: 'lookup_failed' },
    }))
  }
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
