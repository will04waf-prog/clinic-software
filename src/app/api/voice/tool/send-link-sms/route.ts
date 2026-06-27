/**
 * POST /api/voice/tool/send-link-sms — Phase 5 W2.
 *
 * Mid-call: Layla texts the caller a one-tap link so she can finish
 * "I'll text you the booking page" / "...the link to reschedule" /
 * "...directions" / "...the new-patient form" without escalating.
 * A single route + a closed `link_kind` enum replaces three near-
 * duplicate proposals (send_booking_link_sms, send_directions_sms,
 * send_intake_form_sms) — fewer tool slots in the LLM's schema, one
 * shared rate-limit/log path.
 *
 * SECURITY MODEL — asymmetric spoof resistance:
 *   - SMS destination is ALWAYS the caller-ID number from the Vapi
 *     envelope (`fromE164`). The LLM CANNOT supply the destination;
 *     a spoofer can only deliver SMS to the number they spoofed
 *     (which by definition they don't control), so a successful
 *     attack is self-defeating.
 *   - The LLM picks a `link_kind` from a closed enum; this route
 *     maps kind → URL server-side. The LLM never supplies a raw
 *     URL, so it cannot exfiltrate or phish.
 *   - Body carries zero PHI — clinic name + public URL + STOP. Even
 *     the manage link uses a signed token; the URL itself reveals
 *     nothing about the patient.
 *   - link_kind='manage' is the only branch that touches an
 *     individual patient's record. It re-validates the supplied
 *     consultation_id against the caller-ID-resolved contact + org
 *     + status IN ('scheduled','confirmed') — mirroring my-
 *     appointments + cancel-appointment so the LLM cannot text a
 *     manage link for someone else's booking.
 *   - Standard gate stack: org.sms_enabled, isTwilioConfigured,
 *     contact.opted_out_sms=false. For the PHI-bearing manage link
 *     we additionally require stored contact.sms_consent=true.
 *     `consent_confirmed` from the LLM is logged for audit but does
 *     NOT substitute for the stored consent flag on PHI links.
 *   - Per-(kind, from_e164_tail) rate-limit: refuse if an identical
 *     send happened in the last 60s. Stops a runaway LLM from
 *     spamming the caller's pocket. Check is done via activity_log
 *     `.contains('metadata', {...})` lookup.
 *
 * sms_log gets a row for every outcome (sent | failed | skipped)
 * via supabaseAdmin (RLS bypass). message_type='confirmation' —
 * reusing the existing enum value because no 'voice_link' value
 * exists and audit disambiguation lives in activity_log + the URL
 * embedded in the body.
 */

import { NextResponse, after } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { verifyVapiSignature } from '@/lib/voice-agent/verify-vapi-signature'
import { getAppUrl } from '@/lib/voice-agent/app-url'
import { toolCallFromVapiPayload, toolCallResponseForVapi } from '@/lib/voice-agent/tool-types'
import { normalizePhone } from '@/lib/validators'
import { sendSMS, isTwilioConfigured } from '@/lib/twilio'
import { signManageToken } from '@/lib/booking/manage-token'


const LINK_KINDS = ['booking', 'manage', 'intake', 'directions'] as const
type LinkKind = (typeof LINK_KINDS)[number]

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SLUG_RE = /^[a-z0-9-]{1,80}$/i
const URL_RE  = /^https?:\/\/[^\s]{4,500}$/i

const MAX_BODY_LEN  = 320 // 2x standard SMS segment — keep tight to discourage carrier multi-segment fragmentation.
const RATE_LIMIT_MS = 60_000

function isLinkKind(v: unknown): v is LinkKind {
  return typeof v === 'string' && (LINK_KINDS as readonly string[]).includes(v)
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

export async function POST(req: Request) {
  if (!verifyVapiSignature(req)) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const tc = toolCallFromVapiPayload(body)
  if (!tc) {
    return NextResponse.json({ error: 'unrecognized_payload_shape' }, { status: 400 })
  }

  // ── Argument validation ─────────────────────────────────────────
  const args = tc.arguments
  const linkKind = args.link_kind
  if (!isLinkKind(linkKind)) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: false,
      error: `link_kind must be one of ${LINK_KINDS.join(', ')}`,
    }))
  }

  const consentConfirmed = args.consent_confirmed === true
  if (!consentConfirmed) {
    // The LLM is required to ask "want me to text it to you?" before
    // calling this tool. Refusing here is defense-in-depth — owner
    // policy could still require this even if the gate stack would
    // otherwise let the send through.
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: false,
      error: 'consent_confirmed must be true — verbally confirm the caller wants the text first',
    }))
  }

  const consultationId = typeof args.consultation_id === 'string' ? args.consultation_id : undefined
  if (consultationId !== undefined && !UUID_RE.test(consultationId)) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: false,
      error: 'consultation_id must be a uuid',
    }))
  }
  if (linkKind === 'manage' && !consultationId) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: false,
      error: 'consultation_id is required for link_kind=manage',
    }))
  }

  const rawServiceSlug = typeof args.service_slug === 'string' ? args.service_slug.trim() : ''
  // Cap input length before any DB work and silently ignore garbage
  // shapes — the LLM occasionally hands back a full service name; we
  // slugify on the way in so "Botox Consultation" → "botox-consultation".
  const serviceSlugInput = rawServiceSlug.length > 0 && rawServiceSlug.length <= 200
    ? slugify(rawServiceSlug).slice(0, 80)
    : ''
  const serviceSlug = serviceSlugInput && SLUG_RE.test(serviceSlugInput) ? serviceSlugInput : ''

  // ── Call envelope ───────────────────────────────────────────────
  // SMS destination is HARD-LOCKED to tc.fromE164 (Vapi envelope) so a
  // caller-id-spoofing attacker can only deliver SMS to the number
  // they're already spoofing. We do accept args.to_e164/from_e164
  // overrides for the Vapi dashboard test harness, but ONLY in
  // non-production — production never honors LLM-supplied phones.
  const allowArgOverride = process.env.NODE_ENV !== 'production'
  const argsToE164   = allowArgOverride && typeof args.to_e164   === 'string' ? args.to_e164   : undefined
  const argsFromE164 = allowArgOverride && typeof args.from_e164 === 'string' ? args.from_e164 : undefined
  const toE164   = normalizePhone(argsToE164   ?? tc.toE164   ?? '')
  const fromE164 = normalizePhone(argsFromE164 ?? tc.fromE164 ?? '')
  // Diagnostic — match the my-appointments envelope log so we catch
  // future Vapi payload-shape drift. Last 4 digits only, never the
  // full caller id.
  console.log('[voice/tool/send-link-sms] envelope', {
    callSid:         tc.callSid,
    toolFromPresent: Boolean(tc.fromE164),
    fromTail:        (fromE164 ?? '').slice(-4),
    toTail:          (toE164 ?? '').slice(-4),
    overrideUsed:    Boolean(argsToE164 || argsFromE164),
  })
  if (!toE164) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: false,
      error: 'Missing or unparseable to_e164',
    }))
  }
  if (!fromE164) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: false,
      error: 'Missing or unparseable caller id (from_e164) — cannot text the caller without a destination',
    }))
  }
  const fromTail = fromE164.slice(-4)

  // ── Resolve org + gate ──────────────────────────────────────────
  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select(
      'id, name, slug, timezone, call_agent_enabled, call_agent_baa_attested_at, sms_enabled, sms_confirmation_enabled, intake_form_url, address_line1, address_line2, city, region, postal_code, country_code, google_place_id',
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
  if (!org.sms_enabled) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: false,
      error: 'sms_not_enabled',
    }))
  }
  if (org.sms_confirmation_enabled === false) {
    // Reuses the confirmation toggle as the master "transactional SMS
    // off" switch — same convention as booking/cancel + voice/cancel
    // (no separate per-link toggle, audit disambiguation lives in
    // activity_log).
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: false,
      error: 'sms_transactional_disabled',
    }))
  }
  if (!isTwilioConfigured()) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: false,
      error: 'sms_provider_not_configured',
    }))
  }

  // ── Rate-limit (per kind + from_e164 tail, last 60s) ────────────
  const sinceIso = new Date(Date.now() - RATE_LIMIT_MS).toISOString()
  const { data: recent } = await supabaseAdmin
    .from('activity_log')
    .select('id')
    .eq('organization_id', org.id)
    .eq('action', 'voice_link_sent')
    .gte('created_at', sinceIso)
    .contains('metadata', { link_kind: linkKind, from_e164_tail: fromTail })
    .limit(1)
  if (recent && recent.length > 0) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: true,
      output: { sent: false, reason: 'rate_limited', link_kind: linkKind },
    }))
  }

  // ── Resolve contact (best-effort; required only for manage) ─────
  const last10 = fromE164.replace(/\D/g, '').slice(-10)
  let contact: { id: string; first_name: string | null; phone: string | null; opted_out_sms: boolean | null; sms_consent: boolean | null } | null = null
  if (last10.length === 10) {
    const { data: candidates } = await supabaseAdmin
      .from('contacts_active')
      .select('id, first_name, phone, opted_out_sms, sms_consent')
      .eq('organization_id', org.id)
      .ilike('phone', `%${last10}`)
      .limit(5)
    contact = (candidates ?? []).find(
      c => (c.phone ?? '').replace(/\D/g, '').slice(-10) === last10,
    ) ?? null
  }
  if (contact?.opted_out_sms) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: false,
      error: 'caller_opted_out_sms',
    }))
  }
  // Cross-archive opt-out check: when an active-contact match misses
  // (unknown caller OR caller whose contact was archived after they
  // STOP'd), still consult the base contacts table for an opt-out
  // record on this phone. Otherwise STOP-then-re-call could be used
  // to bypass the opt-out by getting Layla to text the caller again.
  if (!contact && last10.length === 10) {
    const { data: archivedOptOut } = await supabaseAdmin
      .from('contacts')
      .select('id, opted_out_sms, phone')
      .eq('organization_id', org.id)
      .eq('opted_out_sms', true)
      .ilike('phone', `%${last10}`)
      .limit(5)
    const optedOut = (archivedOptOut ?? []).some(
      c => (c.phone ?? '').replace(/\D/g, '').slice(-10) === last10,
    )
    if (optedOut) {
      return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
        ok: false,
        error: 'caller_opted_out_sms',
      }))
    }
  }

  // ── Build the URL for this kind ─────────────────────────────────
  let url: string | null = null
  let bodyCopy: string | null = null

  if (linkKind === 'booking') {
    if (!org.slug) {
      return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
        ok: false,
        error: 'org_missing_booking_slug',
      }))
    }
    let bookingUrl = `${getAppUrl()}/book/${org.slug}`
    if (serviceSlug) {
      // Validate the service belongs to this org and is publicly
      // bookable. Silently drop the qs if not — the LLM may guess
      // a name that doesn't match exactly; we'd rather still send
      // a usable generic booking link than refuse the whole send.
      const { data: services } = await supabaseAdmin
        .from('services')
        .select('id, name')
        .eq('organization_id', org.id)
        .eq('is_active', true)
        .eq('is_bookable_online', true)
        .limit(50)
      const matched = (services ?? []).find(s =>
        slugify(s.name ?? '') === serviceSlug,
      )
      if (matched) {
        bookingUrl += `?service=${encodeURIComponent(serviceSlug)}`
      }
    }
    url = bookingUrl
    bodyCopy = `${org.name ?? 'Your clinic'}: book here ${url} Reply STOP to opt out.`
  } else if (linkKind === 'manage') {
    if (!contact) {
      return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
        ok: true,
        output: { sent: false, reason: 'caller_not_recognized' },
      }))
    }
    // Stored consent gate — verbal consent does NOT substitute for
    // sms_consent on PHI-bearing links.
    if (!contact.sms_consent) {
      return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
        ok: false,
        error: 'sms_consent_missing_on_contact',
      }))
    }
    // Re-validate consultation_id ownership + state. Mirrors my-
    // appointments + cancel-appointment so the LLM can't text a
    // manage link for someone else's booking.
    const { data: consultation } = await supabaseAdmin
      .from('consultations')
      .select('id, scheduled_at, status, organization_id, contact_id')
      .eq('id', consultationId!)
      .eq('organization_id', org.id)
      .eq('contact_id', contact.id)
      .in('status', ['scheduled', 'confirmed'])
      .maybeSingle()
    if (!consultation) {
      return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
        ok: true,
        output: { sent: false, reason: 'consultation_not_manageable' },
      }))
    }
    let token: string
    try {
      token = signManageToken(consultation.id)
    } catch (err) {
      console.error('[voice/send-link-sms manage] sign failed:', err instanceof Error ? err.message : 'unknown')
      return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
        ok: false,
        error: 'manage_token_unavailable',
      }))
    }
    url = `${getAppUrl()}/manage/${token}`
    bodyCopy = `${org.name ?? 'Your clinic'}: manage your appointment ${url} Reply STOP to opt out.`
  } else if (linkKind === 'intake') {
    const raw = typeof org.intake_form_url === 'string' ? org.intake_form_url.trim() : ''
    if (!raw || !URL_RE.test(raw)) {
      return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
        ok: false,
        error: 'no_intake_form_configured',
      }))
    }
    url = raw
    bodyCopy = `${org.name ?? 'Your clinic'}: new-patient form ${url} Reply STOP to opt out.`
  } else if (linkKind === 'directions') {
    const placeId = typeof org.google_place_id === 'string' ? org.google_place_id.trim() : ''
    const line1   = typeof org.address_line1   === 'string' ? org.address_line1.trim()   : ''
    const city    = typeof org.city            === 'string' ? org.city.trim()            : ''
    if (!placeId && !(line1 && city)) {
      return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
        ok: false,
        error: 'no_address_configured',
      }))
    }
    if (placeId) {
      url = `https://maps.google.com/?q=place_id:${encodeURIComponent(placeId)}`
    } else {
      const parts = [
        line1,
        typeof org.address_line2 === 'string' ? org.address_line2.trim() : '',
        city,
        [
          typeof org.region      === 'string' ? org.region.trim()      : '',
          typeof org.postal_code === 'string' ? org.postal_code.trim() : '',
        ].filter(Boolean).join(' ').trim(),
        typeof org.country_code === 'string' ? org.country_code.trim() : '',
      ].filter(Boolean)
      url = `https://maps.google.com/?q=${encodeURIComponent(parts.join(', '))}`
    }
    bodyCopy = `${org.name ?? 'Your clinic'}: directions ${url} Reply STOP to opt out.`
  }

  if (!url || !bodyCopy) {
    // Shouldn't happen — every branch sets both, but be defensive.
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: false,
      error: 'internal_build_failure',
    }))
  }

  // Refuse instead of truncating — silently cutting the body could
  // chop the URL tail or the STOP disclaimer (TCPA-mandatory). If a
  // clinic's intake URL or display name pushes us over, the operator
  // needs to know so they can shorten it.
  if (bodyCopy.length > MAX_BODY_LEN) {
    console.error('[voice/send-link-sms] body_too_long', {
      length:   bodyCopy.length,
      cap:      MAX_BODY_LEN,
      linkKind,
      orgId:    org.id,
    })
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: false,
      error: 'body_too_long',
    }))
  }

  // ── Pre-send rate-limit sentinel ────────────────────────────────
  // Write the activity_log row BEFORE calling Twilio so a concurrent
  // tool call sees it on the SELECT above and short-circuits. Without
  // this, two near-simultaneous LLM-driven calls both observe an
  // empty result set and both fire SMS. The row carries status='pending'
  // until the after() block patches it; the read-side filter only
  // checks (link_kind, from_e164_tail), not status, so pending counts.
  const smsLogConsultationId = linkKind === 'manage' ? consultationId! : null
  const { data: sentinel } = await supabaseAdmin
    .from('activity_log')
    .insert({
      organization_id: org.id,
      contact_id:      contact?.id ?? null,
      action:          'voice_link_sent',
      metadata: {
        link_kind:        linkKind,
        from_e164_tail:   fromTail,
        call_sid:         tc.callSid ?? null,
        consultation_id:  smsLogConsultationId,
        status:           'pending',
        service_slug:     serviceSlug || null,
        verbal_consent:   consentConfirmed,
      },
    })
    .select('id')
    .single()

  // ── Send + log ──────────────────────────────────────────────────
  // We send synchronously (before responding) so the LLM can speak
  // with confidence: "I just texted it to you." If the send fails
  // we surface a soft fail; we don't pretend it went through.
  let sendResult: { provider_id: string; status: string } | null = null
  let sendError: string | null = null
  try {
    sendResult = await sendSMS(fromE164, bodyCopy)
  } catch (err: any) {
    sendError = err?.message ?? 'send_failed'
  }

  // sms_log row — supabaseAdmin bypasses RLS, mirrors the gate-and-
  // log block in /api/booking/cancel + /api/voice/tool/cancel-
  // appointment. consultation_id is set only on the manage branch
  // (the only kind tied to a specific booking).
  const smsStatus = sendError ? 'failed' : sendResult ? 'sent' : 'skipped'
  after(async () => {
    try {
      await supabaseAdmin.from('sms_log').insert({
        organization_id: org.id,
        contact_id:      contact?.id ?? null,
        consultation_id: smsLogConsultationId,
        message_type:    'confirmation',
        to_number:       fromE164,
        body:            bodyCopy,
        status:          smsStatus,
        provider_id:     sendResult?.provider_id ?? null,
        error_message:   sendError ?? (smsStatus === 'skipped' ? 'Twilio returned null (unparseable phone or unconfigured)' : null),
      })
    } catch (err) {
      console.error('[voice/send-link-sms sms_log] insert failed', err)
    }
  })

  // Patch the sentinel row's status now that we know the outcome.
  // The row's existence already satisfies the rate-limit gate; this
  // update just upgrades 'pending' → 'sent' | 'failed' | 'skipped'
  // for the owner's analytics view.
  if (sentinel?.id) {
    after(async () => {
      try {
        await supabaseAdmin
          .from('activity_log')
          .update({
            metadata: {
              link_kind:        linkKind,
              from_e164_tail:   fromTail,
              call_sid:         tc.callSid ?? null,
              consultation_id:  smsLogConsultationId,
              status:           smsStatus,
              service_slug:     serviceSlug || null,
              verbal_consent:   consentConfirmed,
            },
          })
          .eq('id', sentinel.id)
      } catch (err) {
        console.error('[voice/send-link-sms activity_log] status patch failed', err)
      }
    })
  }

  if (sendError) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: false,
      error: 'sms_send_failed',
    }))
  }

  return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
    ok: true,
    output: {
      sent:      true,
      link_kind: linkKind,
      to_tail:   fromTail,
    },
  }))
}
