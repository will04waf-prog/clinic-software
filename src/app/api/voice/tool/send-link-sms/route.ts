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
 *
 * RATE-LIMIT MODEL — DB-as-primitive, no TOCTOU:
 *   - Phase 5 W2 sweep-3 moved the rate-limit from a SELECT-then-
 *     INSERT pattern (which two concurrent tool calls could both
 *     pass) to a UNIQUE partial index on
 *     activity_log (org_id, metadata->>link_kind,
 *                    metadata->>from_e164_tail,
 *                    date_trunc('minute', created_at))
 *     WHERE action='voice_link_sent'.
 *     See migration 20260712100000_voice_link_sent_uniq.sql.
 *   - The INSERT itself IS the rate-limit primitive. We insert the
 *     sentinel BEFORE calling Twilio: a second concurrent INSERT
 *     gets 23505 (unique_violation) and the route maps that to
 *     reason='rate_limited'. No window.
 *   - If Twilio then fails, we DELETE the sentinel synchronously
 *     before returning so a legitimate retry isn't blocked for the
 *     remainder of the minute by our own failed attempt.
 *   - If the INSERT raises any error OTHER than 23505 (e.g. DB
 *     unavailable), we surface ok:false sms_provider_unavailable
 *     and refuse to send — we'd rather drop the message than send
 *     unrated.
 *
 * RETURN-SHAPE CONTRACT:
 *   Business-logic "won't send" outcomes use {ok:true, output:{
 *     sent:false, reason:<closed enum, see WontSendReason>}}.
 *   This includes rate_limited, all the gate-stack outcomes, and the
 *   per-link-kind config failures. The receptionist prompt scripts
 *   the spoken response for each reason; keeping ok:true keeps the
 *   LLM from treating these as transport errors and retrying.
 *   ok:false is reserved for genuine infra/payload failures:
 *   invalid_signature (401), unrecognized_payload_shape (400),
 *   bad arg shape (link_kind missing, consent_confirmed != true,
 *   non-uuid consultation_id), missing call envelope, org not
 *   mapped, voice-agent not enabled, sentinel DB write failure
 *   (sms_provider_unavailable), and Twilio send failure
 *   (sms_send_failed).
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
import { getVerticalConfig } from '@/lib/vertical/config'


const LINK_KINDS = ['booking', 'manage', 'intake', 'directions'] as const
type LinkKind = (typeof LINK_KINDS)[number]

/**
 * Closed enum of "won't send" reasons surfaced via
 * {ok:true, output:{sent:false, reason}}. Kept in lockstep with the
 * receptionist prompt's per-reason spoken response and with the
 * description on TOOL_SEND_LINK_SMS in src/voice/tools/schemas.ts.
 * Adding a value here means updating both.
 */
type WontSendReason =
  | 'rate_limited'
  | 'caller_not_recognized'
  | 'consultation_not_manageable'
  | 'caller_opted_out_sms'
  | 'sms_consent_missing_on_contact'
  | 'sms_not_enabled'
  | 'sms_transactional_disabled'
  | 'sms_provider_not_configured'
  | 'no_address_configured'
  | 'no_intake_form_configured'
  | 'manage_token_unavailable'
  | 'org_missing_booking_slug'
  | 'body_too_long'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SLUG_RE = /^[a-z0-9-]{1,80}$/i
const URL_RE  = /^https?:\/\/[^\s]{4,500}$/i

const MAX_BODY_LEN  = 320 // 2x standard SMS segment — keep tight to discourage carrier multi-segment fragmentation.

function isLinkKind(v: unknown): v is LinkKind {
  return typeof v === 'string' && (LINK_KINDS as readonly string[]).includes(v)
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

/**
 * Postgres unique_violation. supabase-js surfaces this on
 * { error: { code: '23505' } } when a unique index rejects an insert.
 */
function isUniqueViolation(err: unknown): boolean {
  return Boolean(
    err
    && typeof err === 'object'
    && 'code' in err
    && (err as { code?: unknown }).code === '23505',
  )
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
  // These are payload-shape errors, NOT business-logic outcomes:
  // a well-behaved LLM with the published schema should never trip
  // them. We surface ok:false so a misbehaving LLM gets a hard
  // signal instead of a soft "{sent:false}" it might happily ignore.
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
    // otherwise let the send through. Treated as a payload error
    // (ok:false) so the LLM cannot misread it as a "blocked but
    // recoverable" reason.
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
    // The schema now expresses this as allOf+if/then (Vapi rejects
    // the call before it reaches us). Keep the server check as
    // defense-in-depth — older Vapi clients may not honor conditional
    // requireds, and the PHI-bearing path must never trust the
    // validator alone.
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

  // Small helper to keep the won't-send envelope identical across
  // all the gate-stack branches below.
  const wontSend = (reason: WontSendReason, extra: Record<string, unknown> = {}) =>
    NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: true,
      output: { sent: false, reason, link_kind: linkKind, ...extra },
    }))

  // ── Resolve org + gate ──────────────────────────────────────────
  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select(
      'id, name, slug, vertical, timezone, call_agent_enabled, call_agent_baa_attested_at, sms_enabled, sms_confirmation_enabled, intake_form_url, address_line1, address_line2, city, region, postal_code, country_code, google_place_id',
    )
    .eq('twilio_phone_number', toE164)
    .maybeSingle()
  if (!org) {
    // Org-not-mapped is an infra/config failure (the route was hit
    // for a Twilio DID we don't own). Surface ok:false so this is
    // alertable rather than blending into the "blocked but
    // recoverable" stream.
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
    return wontSend('sms_not_enabled')
  }
  if (org.sms_confirmation_enabled === false) {
    // Reuses the confirmation toggle as the master "transactional SMS
    // off" switch — same convention as booking/cancel + voice/cancel
    // (no separate per-link toggle, audit disambiguation lives in
    // activity_log).
    return wontSend('sms_transactional_disabled')
  }
  if (!isTwilioConfigured()) {
    return wontSend('sms_provider_not_configured')
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
    return wontSend('caller_opted_out_sms')
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
      return wontSend('caller_opted_out_sms')
    }
  }

  // ── Build the URL for this kind ─────────────────────────────────
  let url: string | null = null
  let bodyCopy: string | null = null

  // Multi-vertical Phase 2: customer-facing SMS copy follows the
  // caller's language. The LLM passes `language` for the language the
  // caller is speaking right now; default English. STOP disclaimer is
  // TCPA-mandatory in both languages.
  const lang: 'en' | 'es' = args.language === 'es' ? 'es' : 'en'
  // Multi-vertical Phase 2: the scheduled-thing / org / customer nouns
  // in the link copy follow the tenant's vertical. medspa values in the
  // terms table reproduce today's literals byte-for-byte.
  const { vertical, terms } = getVerticalConfig(org.vertical)
  const linkSmsCopy = (lead: string, linkUrl: string): string => {
    // Fallback display name when the org has no stored name. The ES
    // fallback is generic ('Su negocio') for every vertical — that IS
    // med-spa's baseline, so it stays a literal. The EN fallback keeps
    // the "Your " prefix and swaps only the noun: medspa terms.business
    // is 'clinic', so 'Your clinic' is unchanged; others get 'Your business'.
    const name = org.name ?? (lang === 'es' ? 'Su negocio' : `Your ${terms.business}`)
    const stop = lang === 'es'
      ? 'Responda STOP para no recibir mensajes.'
      : 'Reply STOP to opt out.'
    return `${name}: ${lead} ${linkUrl} ${stop}`
  }

  if (linkKind === 'booking') {
    if (!org.slug) {
      return wontSend('org_missing_booking_slug')
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
    // Cross-task contract: a Spanish-speaking caller gets the public
    // booking page pre-switched to ES via ?lang=es (the /book/[slug]
    // page renders ES off that param). Use the right separator since a
    // ?service= qs may already be present.
    if (lang === 'es') {
      bookingUrl += bookingUrl.includes('?') ? '&lang=es' : '?lang=es'
    }
    url = bookingUrl
    bodyCopy = linkSmsCopy(lang === 'es' ? 'reserve aquí' : 'book here', url)
  } else if (linkKind === 'manage') {
    if (!contact) {
      return wontSend('caller_not_recognized')
    }
    // Stored consent gate — verbal consent does NOT substitute for
    // sms_consent on PHI-bearing links.
    if (!contact.sms_consent) {
      return wontSend('sms_consent_missing_on_contact')
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
      return wontSend('consultation_not_manageable')
    }
    let token: string
    try {
      token = signManageToken(consultation.id)
    } catch (err) {
      console.error('[voice/send-link-sms manage] sign failed:', err instanceof Error ? err.message : 'unknown')
      return wontSend('manage_token_unavailable')
    }
    url = `${getAppUrl()}/manage/${token}`
    // engagement is the /manage voice word, whose med-spa literal IS
    // 'appointment'/'cita' — so terms.engagement is byte-identical here
    // and non-medspa tenants get 'job'/'order'/'trabajo'/'pedido'.
    bodyCopy = linkSmsCopy(
      lang === 'es' ? `gestione su ${terms.engagementEs}` : `manage your ${terms.engagement}`,
      url,
    )
  } else if (linkKind === 'intake') {
    const raw = typeof org.intake_form_url === 'string' ? org.intake_form_url.trim() : ''
    if (!raw || !URL_RE.test(raw)) {
      return wontSend('no_intake_form_configured')
    }
    url = raw
    // The intake noun has no term in the config; med-spa's literal is
    // 'new-patient form' (kept byte-identical via the medspa branch),
    // while other verticals get a neutral customer-intake phrase built
    // from terms.customer/customerEs ('customer intake form').
    bodyCopy = linkSmsCopy(
      vertical === 'medspa'
        ? (lang === 'es' ? 'formulario de nuevo paciente' : 'new-patient form')
        : (lang === 'es' ? `formulario de registro de ${terms.customerEs}` : `${terms.customer} intake form`),
      url,
    )
  } else if (linkKind === 'directions') {
    const placeId = typeof org.google_place_id === 'string' ? org.google_place_id.trim() : ''
    const line1   = typeof org.address_line1   === 'string' ? org.address_line1.trim()   : ''
    const city    = typeof org.city            === 'string' ? org.city.trim()            : ''
    if (!placeId && !(line1 && city)) {
      return wontSend('no_address_configured')
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
    bodyCopy = linkSmsCopy(lang === 'es' ? 'cómo llegar' : 'directions', url)
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
    return wontSend('body_too_long')
  }

  const smsLogConsultationId = linkKind === 'manage' ? consultationId! : null

  // ── Rate-limit sentinel: INSERT-as-primitive ────────────────────
  // The unique partial index on activity_log
  //   (org_id, metadata->>link_kind, metadata->>from_e164_tail,
  //    date_trunc('minute', created_at))
  //   WHERE action='voice_link_sent'
  // (migration 20260712100000_voice_link_sent_uniq.sql) means a
  // second concurrent INSERT for the same (org, kind, caller, minute)
  // bucket is rejected by Postgres with 23505. That IS the rate
  // limit — no SELECT-then-INSERT TOCTOU window. The previous
  // implementation read activity_log first and then inserted; two
  // tool calls firing within the same turn both passed the SELECT
  // and the caller got two texts. Now the second caller gets
  // rate_limited deterministically.
  //
  // If the INSERT raises any error OTHER than 23505 (DB unavailable,
  // schema mismatch), we refuse to send. Sending un-logged would
  // also leave the rate-limit shut for nothing because the next
  // attempt would face the same outage. ok:false is the right
  // signal — this is real infra.
  const sentinelInsert = await supabaseAdmin
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
  if (sentinelInsert.error) {
    if (isUniqueViolation(sentinelInsert.error)) {
      // Bucket already has a row for this minute — second concurrent
      // call lost the race. The prompt scripts a soft response ("I
      // just texted that — should be coming through any second").
      return wontSend('rate_limited')
    }
    console.error('[voice/send-link-sms] sentinel insert failed', {
      orgId:    org.id,
      linkKind,
      code:     (sentinelInsert.error as { code?: string }).code,
      message:  sentinelInsert.error.message,
    })
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: false,
      error: 'sms_provider_unavailable',
    }))
  }
  const sentinelId = sentinelInsert.data?.id ?? null

  // ── Send ────────────────────────────────────────────────────────
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
  const smsStatus = sendError ? 'failed' : sendResult ? 'sent' : 'skipped'

  // ── sms_log row ─────────────────────────────────────────────────
  // supabaseAdmin bypasses RLS, mirrors the gate-and-log block in
  // /api/booking/cancel + /api/voice/tool/cancel-appointment.
  // consultation_id is set only on the manage branch (the only kind
  // tied to a specific booking).
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

  if (sendError) {
    // Twilio failed — delete the sentinel synchronously so a
    // legitimate retry (Layla offers to "try again in a moment") in
    // the same minute isn't blocked by our own failed attempt. The
    // delete is best-effort: if it fails the rate-limit just stays
    // shut until the bucket rolls, which is the safer side to err.
    if (sentinelId) {
      const { error: delErr } = await supabaseAdmin
        .from('activity_log')
        .delete()
        .eq('id', sentinelId)
      if (delErr) {
        console.error('[voice/send-link-sms] sentinel delete after twilio failure', {
          sentinelId,
          code:    (delErr as { code?: string }).code,
          message: delErr.message,
        })
      }
    }
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: false,
      error: 'sms_send_failed',
    }))
  }

  // ── Patch sentinel status pending → sent ────────────────────────
  // The row's existence already satisfied the rate-limit gate; this
  // update just upgrades 'pending' → 'sent' for the owner's
  // analytics view. Skipped status is impossible at this point (we
  // bailed on send error above).
  if (sentinelId) {
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
          .eq('id', sentinelId)
      } catch (err) {
        console.error('[voice/send-link-sms activity_log] status patch failed', err)
      }
    })
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
