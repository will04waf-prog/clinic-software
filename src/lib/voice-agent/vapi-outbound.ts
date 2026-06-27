/**
 * Phase 5 W2 — Vapi outbound-call wrapper.
 *
 * Mirrors the shape of src/lib/twilio.ts:sendSMS:
 *   - isVapiOutboundConfigured() is a cheap env-only check the
 *     caller runs BEFORE attempting a send (the gating loop in
 *     /api/cron/voice-reminders skips and stamps voice_reminder_status
 *     = 'skipped' when this returns false).
 *   - placeOutboundCall() returns null on configuration miss /
 *     unparseable destination — a silent skip, matching the SMS
 *     contract so cron callers can collapse "not configured" and
 *     "invalid phone" into a single null branch. Real failures
 *     (network, 4xx/5xx from Vapi) throw so the caller can write
 *     a 'sent' vs 'skipped' row deterministically.
 *
 * Endpoint reference: POST https://api.vapi.ai/call
 *   body: {
 *     assistantId,           // reminder bot, NOT the inbound receptionist
 *     phoneNumberId,         // Vapi-side phone-number resource that places the call
 *     customer: { number },  // E.164 of the patient
 *     metadata,              // forwarded to the call-end webhook; we pack consultation_id + organization_id here
 *     assistantOverrides?,   // optional per-call variable injection (patient first name, spoken time, etc.)
 *   }
 *
 * The Vapi REST API returns { id, status, ... } where `id` is the
 * Vapi-side call identifier (it eventually becomes the Twilio
 * CallSid in some setups, but we treat it as opaque). We stamp it
 * onto consultations.voice_reminder_call_sid so the call-end
 * webhook can correlate the disposition back to the consultation
 * without re-scanning recent rows.
 *
 * No PHI is logged. The Vapi error response may include the
 * patient number — the catch block in the caller already swallows
 * it; this module only console.error's the status code + a
 * truncated body length, never the body itself.
 */

import { normalizePhone } from '@/lib/validators'

export interface VapiOutboundConfig {
  apiKey:        string
  phoneNumberId: string
}

export type VapiCallResult = { provider_id: string; status: string } | null

export interface PlaceOutboundCallArgs {
  /** Vapi assistant id for the reminder bot. */
  assistantId: string
  /** Patient phone — will be E.164-normalized inside. */
  to: string
  /** Optional first-name to pass to the bot for personalization. */
  customerName?: string | null
  /**
   * Forwarded verbatim to the Vapi call-end webhook. The cron
   * packs { consultation_id, organization_id } so the webhook can
   * resolve the row without scanning recent calls.
   */
  metadata?: Record<string, unknown>
  /**
   * Optional per-call assistant variable injection. The reminder
   * prompt references {{spoken_time}}, {{patient_first_name}},
   * {{manage_url}} — the caller resolves those synchronously
   * (mirroring the manage-token-signed-before-after() pattern in
   * confirm-impl.ts) and passes them here.
   */
  assistantOverrides?: {
    variableValues?: Record<string, string>
    firstMessage?:   string
  }
}

export function isVapiOutboundConfigured(): boolean {
  return !!(process.env.VAPI_API_KEY && process.env.VAPI_PHONE_NUMBER_ID)
}

/**
 * Place an outbound call via Vapi.
 *
 * Returns:
 *   { provider_id, status } on a 2xx from Vapi.
 *   null when env is not configured OR the destination phone is
 *     unparseable. Caller treats either as "skipped" (write a
 *     voice_reminder_status='skipped' row, do not retry next tick).
 *
 * Throws:
 *   On any non-2xx response from Vapi OR a network failure. Caller
 *   should catch and write a 'sent' or 'skipped' row depending on
 *   policy — for the reminder cron we currently re-throw out of the
 *   per-row loop body, mark the row 'skipped', and let the next
 *   tick attempt the remaining rows.
 */
export async function placeOutboundCall(args: PlaceOutboundCallArgs): Promise<VapiCallResult> {
  if (!isVapiOutboundConfigured()) {
    console.warn('[vapi-outbound] not configured — skipping placeOutboundCall')
    return null
  }
  const apiKey        = process.env.VAPI_API_KEY!
  const phoneNumberId = process.env.VAPI_PHONE_NUMBER_ID!

  const e164 = normalizePhone(args.to)
  if (!e164) {
    console.warn('[vapi-outbound] unparseable destination phone — skipping')
    return null
  }

  const body: Record<string, unknown> = {
    assistantId:   args.assistantId,
    phoneNumberId,
    customer: {
      number: e164,
      ...(args.customerName ? { name: args.customerName } : {}),
    },
    ...(args.metadata           ? { metadata: args.metadata } : {}),
    ...(args.assistantOverrides ? { assistantOverrides: args.assistantOverrides } : {}),
  }

  const res = await fetch('https://api.vapi.ai/call', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    // PHI-safe error log — never include the body, which may echo
    // the destination phone or assistant variable values. Status +
    // length-of-response is enough to triage from logs.
    const text = await res.text().catch(() => '')
    console.error(`[vapi-outbound] Vapi returned ${res.status}; body length ${text.length}`)
    throw new Error(`vapi_outbound_failed_${res.status}`)
  }

  const json = await res.json().catch(() => ({})) as { id?: string; status?: string }
  if (!json.id) {
    console.error('[vapi-outbound] Vapi 2xx but response missing id')
    throw new Error('vapi_outbound_missing_id')
  }

  return {
    provider_id: json.id,
    status:      json.status ?? 'queued',
  }
}
