/**
 * POST /api/voice/tool/give-directions — Phase 5 W2.
 *
 * Top-3 inbound question for clinics: "where are you located?" /
 * "how do I get there?" Today Layla has no clinic address to read
 * and defers to a human. This tool resolves the org from the Twilio
 * `to` number and returns a formatted spoken address plus
 * Google/Apple Maps URLs so the LLM can read directions aloud (and
 * optionally pair with send_link_sms link_kind='directions' for the
 * "I'm driving, text it to me" case).
 *
 * Zero PHI. Address is public business info. Caller-ID is irrelevant
 * to the response — spoofing yields nothing. We still apply the
 * standard call_agent_enabled + BAA gate for parity with other
 * voice tools.
 *
 * Returns ok:false if no address is configured so the LLM can fall
 * back gracefully ("I don't have our address on file — let me grab
 * the front desk").
 */

import { NextResponse, after } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { verifyVapiSignature } from '@/lib/voice-agent/verify-vapi-signature'
import { resolveCallEnvelope } from '@/lib/voice-agent/resolve-envelope'
import { toolCallFromVapiPayload, toolCallResponseForVapi } from '@/lib/voice-agent/tool-types'
import { normalizePhone } from '@/lib/validators'

const MAX_FREE_TEXT = 500

export async function POST(req: Request) {
  if (!verifyVapiSignature(req)) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const tc = toolCallFromVapiPayload(body)
  if (!tc) {
    return NextResponse.json({ error: 'unrecognized_payload_shape' }, { status: 400 })
  }

  // Args overrides for dashboard test calls. Production reads from
  // the Vapi call envelope.
  // Identity hard-locked to call envelope in prod; LLM-supplied
  // to_e164/from_e164/phone_number args refused outside dev.
  const { toE164 } = resolveCallEnvelope(tc)
  if (!toE164) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: false,
      error: 'Missing or unparseable to_e164',
    }))
  }

  // LLM hint: defaults true. Free-form parking/wayfinding nuance is
  // appended to the spoken response when present.
  const includeParkingNotes = tc.arguments.include_parking_notes === false ? false : true

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select(
      'id, name, address_line1, address_line2, city, region, postal_code, country_code, google_place_id, directions_notes, timezone, call_agent_enabled, call_agent_baa_attested_at',
    )
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

  // Need at least a street line + city for a useful spoken response.
  // If those aren't set, surface a graceful soft-fail so the LLM
  // hands off to a human instead of reading a half-blank address.
  const line1 = typeof org.address_line1 === 'string' ? org.address_line1.trim() : ''
  const city  = typeof org.city          === 'string' ? org.city.trim()          : ''
  if (!line1 || !city) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: false,
      error: 'no_address_configured',
    }))
  }

  const line2       = typeof org.address_line2 === 'string' ? org.address_line2.trim() : ''
  const region      = typeof org.region        === 'string' ? org.region.trim()        : ''
  const postalCode  = typeof org.postal_code   === 'string' ? org.postal_code.trim()   : ''
  const countryCode = typeof org.country_code  === 'string' ? org.country_code.trim()  : ''
  const placeId     = typeof org.google_place_id  === 'string' ? org.google_place_id.trim()  : ''
  const rawNotes    = typeof org.directions_notes === 'string' ? org.directions_notes.trim() : ''
  // Hard cap on free-text we read aloud. The column is text with no
  // DB-side limit; defend against an owner pasting a 5KB blob.
  const directionsNotes = rawNotes.slice(0, MAX_FREE_TEXT)

  // Single-line formatted address for the SMS body / map query. Skip
  // empty parts so we don't emit ", , ," runs.
  const parts = [
    line1,
    line2 || null,
    city,
    [region, postalCode].filter(Boolean).join(' ').trim() || null,
    countryCode || null,
  ].filter((p): p is string => Boolean(p && p.length))
  const formatted = parts.join(', ')

  // Spoken form is what the LLM reads aloud. We keep it close to the
  // formatted line but drop the country code (rarely useful when
  // spoken) and the suite line, which the LLM can mention separately
  // if relevant.
  const spokenParts = [
    line1,
    line2 || null,
    city,
    [region, postalCode].filter(Boolean).join(' ').trim() || null,
  ].filter((p): p is string => Boolean(p && p.length))
  const spokenAddress = spokenParts.join(', ')

  // Maps deep links. Prefer google_place_id when present — stable,
  // deterministic, no geocoding cost. Otherwise fall back to a
  // query-string-encoded formatted address.
  const mapsUrl = placeId
    ? `https://maps.google.com/?q=place_id:${encodeURIComponent(placeId)}`
    : `https://maps.google.com/?q=${encodeURIComponent(formatted)}`
  const appleMapsUrl = `https://maps.apple.com/?q=${encodeURIComponent(formatted)}`

  // Compose the spoken response. The LLM is free to rephrase — we
  // give a ready-to-read string so worst case it just reads ours.
  const speakNotes = includeParkingNotes && directionsNotes.length > 0
  const spoken = speakNotes
    ? `We're at ${spokenAddress}. ${directionsNotes}`
    : `We're at ${spokenAddress}.`

  // Best-effort analytics. Don't block the response on it.
  after(async () => {
    try {
      await supabaseAdmin.from('activity_log').insert({
        organization_id: org.id,
        action:          'voice_directions_spoken',
        metadata: {
          call_sid:           tc.callSid ?? null,
          to_e164:            toE164,
          had_place_id:       Boolean(placeId),
          had_directions_notes: Boolean(directionsNotes),
          included_notes:     speakNotes,
        },
      })
    } catch (err) {
      console.warn('[voice/tool/give-directions] activity_log insert failed', err)
    }
  })

  return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
    ok: true,
    output: {
      clinic_name:       org.name ?? null,
      formatted_address: formatted,
      spoken_address:    spokenAddress,
      spoken,
      address: {
        line1,
        line2:        line2 || null,
        city,
        region:       region || null,
        postal_code:  postalCode || null,
        country_code: countryCode || null,
      },
      maps_url:         mapsUrl,
      apple_maps_url:   appleMapsUrl,
      google_place_id:  placeId || null,
      directions_notes: directionsNotes || null,
    },
  }))
}
