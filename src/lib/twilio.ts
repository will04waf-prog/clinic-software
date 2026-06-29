import twilio from 'twilio'
import { normalizePhone } from '@/lib/validators'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { recordUsage } from '@/lib/billing/metered-usage'

export function isTwilioConfigured(): boolean {
  return !!(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_PHONE_NUMBER
  )
}

export function getTwilioClient() {
  return twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!)
}

/**
 * Phase 5 M4 — A2P 10DLC send-time gate.
 *
 * Outbound SMS from an unregistered (or rejected) brand is heavily
 * filtered by U.S. carriers. Once we flip A2P_REQUIRED=true the
 * platform refuses to ship messages from orgs whose a2p_status is not
 * 'approved' — this is the production guard that prevents a misrouted
 * marketing automation from burning the entire account's reputation.
 *
 * The gate is OPT-IN by env: A2P_REQUIRED defaults to undefined so
 * existing flows (dev, staging, the prior single-shared-number era)
 * continue working unchanged. We expect the integration sweep to flip
 * this on AFTER the M5 provisioning runner has migrated every prod
 * org to its own approved brand+campaign.
 *
 * Failure shape: returns a structured `{ skipped: true, reason: 'a2p_not_approved' }`
 * sentinel object distinct from `null` (which still means "Twilio not
 * configured" / unparseable phone). Callers that already null-check
 * sendSMS continue to no-op on the gate, which is the safe default;
 * call-sites that want to surface a specific user-facing error can
 * narrow on `'reason' in result`.
 */
export interface SendSMSOptions {
  /** Org whose a2p_status governs the send. When supplied AND
   * A2P_REQUIRED=true is set, sendSMS short-circuits unless that org's
   * a2p_status is 'approved'. */
  organizationId?: string
}

export interface SendSMSSkipped {
  provider_id: null
  status:      'skipped'
  reason:      'a2p_not_approved'
}

export type SendSMSResult =
  | { provider_id: string; status: string }
  | SendSMSSkipped
  | null

/**
 * Internal: returns true if the gate is ENFORCING and the org isn't
 * approved. Returns false otherwise (gate disabled, no org id supplied,
 * or org is approved). Errors during lookup fail OPEN — a Supabase
 * blip shouldn't block transactional SMS. We log so the operator can
 * tell the difference between "intentionally skipped" and "lookup
 * failed".
 */
async function isA2pSendBlocked(organizationId: string | undefined): Promise<boolean> {
  if (process.env.A2P_REQUIRED !== 'true') return false
  if (!organizationId) return false

  const { data, error } = await supabaseAdmin
    .from('organizations')
    .select('a2p_status')
    .eq('id', organizationId)
    .single()

  if (error) {
    console.error('[sms] a2p gate lookup failed — failing open:', error.message)
    return false
  }
  return (data?.a2p_status ?? 'not_started') !== 'approved'
}

// Overloads: a call without opts keeps the legacy return type
// `{ provider_id: string; status } | null` so existing callers don't
// have to widen their narrowing logic. A call WITH opts widens to the
// SendSMSResult union (which can also be the SendSMSSkipped sentinel).
// The runtime body is unchanged either way.
export async function sendSMS(
  to: string,
  body: string,
): Promise<{ provider_id: string; status: string } | null>
export async function sendSMS(
  to: string,
  body: string,
  opts: SendSMSOptions,
): Promise<SendSMSResult>
export async function sendSMS(
  to: string,
  body: string,
  opts: SendSMSOptions = {},
): Promise<SendSMSResult> {
  if (!isTwilioConfigured()) {
    console.warn('[sms] Twilio not configured — skipping send')
    return null
  }

  // A2P gate. Runs BEFORE Twilio.create so a blocked send never bills
  // and never enters the carrier filter funnel. Note the gate is
  // off-by-default — see SendSMSOptions docblock for the rollout plan.
  if (await isA2pSendBlocked(opts.organizationId)) {
    console.warn(`[sms] A2P_REQUIRED is on and org ${opts.organizationId} is not approved — refusing send`)
    return { provider_id: null, status: 'skipped', reason: 'a2p_not_approved' }
  }

  const fromNumber = process.env.TWILIO_PHONE_NUMBER!
  const client = getTwilioClient()

  const e164 = normalizePhone(to)
  if (!e164) {
    console.warn('[sms] Unparseable phone number, skipping send:', to)
    return null
  }

  const message = await client.messages.create({ body, from: fromNumber, to: e164 })

  // Phase 5 M7 — metered-billing audit. Best-effort: a failed insert
  // never blocks the successful Twilio send from the caller's
  // perspective. The unique partial index on (org, kind, source_ref)
  // means a duplicate call with the same message.sid (defensive against
  // any future retry-loop caller) collapses at the DB layer rather
  // than double-billing through Stripe.
  //
  // V1 quantity: exactly 1 segment per send. Twilio reports the actual
  // segment count via status callbacks (messages.numSegments), but the
  // status-callback path isn't wired up yet — when it lands we replace
  // the constant 1 with the real count and back-fill via the cron's
  // 35-day Stripe meter window.
  if (opts.organizationId) {
    try {
      await recordUsage({
        organizationId: opts.organizationId,
        kind:           'sms_segment',
        quantity:       1,
        sourceRef:      message.sid,
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[sms] recordUsage failed (non-fatal):', msg)
    }
  }

  return {
    provider_id: message.sid,
    status: message.status,
  }
}

// Replace template variables: {{first_name}}, {{clinic_name}}, etc. — case-insensitive
export function renderTemplate(template: string, vars: Record<string, string>) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key.toLowerCase()] ?? `{{${key}}}`)
}

// ─── Twilio webhook signature verification ────────────────────
//
// Phase 5 W1: extracted from the inbound SMS route so the voice
// webhook can share the same forwarded-URL reconstruction logic.
// Returns true if the signature in the x-twilio-signature header
// matches what Twilio would have produced for this request body +
// reconstructed public URL.
//
// `params` MUST be the exact application/x-www-form-urlencoded body
// parsed into a flat string-keyed object. Twilio signs the
// (URL, params) pair; if a key is missing or its value cast wrong,
// the signature will silently mismatch.
export function verifyTwilioSignature(
  request: Request,
  params: Record<string, string>,
): boolean {
  const authToken = process.env.TWILIO_AUTH_TOKEN
  if (!authToken) {
    // Without an auth token we can't verify. Returning false is
    // safer than no-op pass-through because a misconfigured prod
    // would silently accept forged Twilio requests.
    return false
  }
  // Reconstruct the public URL Twilio originally signed. request.url
  // may report the internal Vercel hostname behind the edge — prefer
  // the forwarded headers so the URL matches what Twilio signed.
  const proto = request.headers.get('x-forwarded-proto') ?? 'https'
  const host  = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? ''
  const path  = new URL(request.url).pathname
  const url   = `${proto}://${host}${path}`
  const signature = request.headers.get('x-twilio-signature') ?? ''
  return twilio.validateRequest(authToken, signature, url, params)
}

// ─── TwiML VoiceResponse builder ──────────────────────────────
//
// Thin wrapper over twilio.twiml.VoiceResponse so the voice webhook
// + status callback can return TwiML without each route reaching
// into the SDK shape directly. Exposes the verbs we actually use
// in W1 — Say (text-to-speech opener / consent), Pause, Hangup,
// Dial (forward to fallback number), Connect+Stream (bridge to
// Vapi). Caller serializes with .toString() before responding.

export type VoiceResponseBuilder = InstanceType<typeof twilio.twiml.VoiceResponse>

export function newVoiceResponse(): VoiceResponseBuilder {
  return new twilio.twiml.VoiceResponse()
}

/**
 * Standard XML response for TwiML. Mirrors emptyTwimlResponse()
 * from the inbound SMS route but with a custom body.
 */
export function twimlResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/xml; charset=utf-8' },
  })
}
