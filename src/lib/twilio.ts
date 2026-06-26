import twilio from 'twilio'
import { normalizePhone } from '@/lib/validators'

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

export async function sendSMS(
  to: string,
  body: string
): Promise<{ provider_id: string; status: string } | null> {
  if (!isTwilioConfigured()) {
    console.warn('[sms] Twilio not configured — skipping send')
    return null
  }

  const fromNumber = process.env.TWILIO_PHONE_NUMBER!
  const client = getTwilioClient()

  const e164 = normalizePhone(to)
  if (!e164) {
    console.warn('[sms] Unparseable phone number, skipping send:', to)
    return null
  }

  const message = await client.messages.create({ body, from: fromNumber, to: e164 })

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
