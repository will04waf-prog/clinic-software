/**
 * Phase 5 M2 — Vapi phone-number REST wrappers.
 *
 * Thin fetch wrappers around the four Vapi endpoints we touch for
 * per-org phone-number provisioning:
 *
 *   POST   /phone-number             — register (NOT idempotent)
 *   GET    /phone-number/{id}        — health probe
 *   PATCH  /phone-number/{id}        — rebind assistant
 *   DELETE /phone-number/{id}        — un-onboard
 *
 * The deliberate design point is that registerNumber() is NOT
 * idempotent. Vapi's POST /phone-number endpoint has been observed
 * to either 409 (when the duplicate detection is on) OR silently
 * create a second resource pointing at the same Twilio number. The
 * caller (M5's register_vapi_phone step handler, and the existing
 * scripts/provision-clinic-phone.ts rescue script) MUST check for an
 * existing binding via GET /phone-number?number=<e164> BEFORE calling
 * registerNumber, or be prepared to recover via the same GET on a
 * 409 / 400 response. This module surfaces the raw 409 — it does
 * NOT auto-recover — because the recovery shape (which kept-id to
 * write back to organizations.vapi_phone_number_id) is a policy
 * decision that belongs to the caller, not the wrapper.
 *
 * Auth: Bearer ${VAPI_API_KEY} — same env var used by the assistant
 * seed scripts and by placeOutboundCall(). Read on every call so
 * tests can override.
 *
 * Errors: every non-2xx is thrown as a VapiApiError carrying the
 * HTTP status and a truncated body for the operator's eyes. We do
 * NOT include the request body in error messages because it would
 * carry the Twilio auth token in the registration payload.
 */

const VAPI_BASE = 'https://api.vapi.ai'

function getAuthHeader(): string {
  const key = process.env.VAPI_API_KEY
  if (!key) {
    throw new Error('vapi_api_key_missing')
  }
  return `Bearer ${key}`
}

export class VapiApiError extends Error {
  readonly status: number
  readonly bodySnippet: string
  constructor(message: string, status: number, bodySnippet: string) {
    super(message)
    this.name = 'VapiApiError'
    this.status = status
    this.bodySnippet = bodySnippet
  }
}

async function throwForBadResponse(res: Response, op: string): Promise<never> {
  const text = await res.text().catch(() => '')
  // Truncate the body to keep error logs PHI-light. Vapi's error
  // bodies are typically JSON with a `message` field and (sometimes)
  // a `provider` field that echoes the Twilio error verbatim. We
  // include the first 240 chars and let the operator click through
  // to Vapi's logs if more detail is needed.
  const snippet = text.slice(0, 240)
  throw new VapiApiError(
    `${op} failed: HTTP ${res.status}${snippet ? `: ${snippet}` : ''}`,
    res.status,
    snippet,
  )
}

// ── 1. registerNumber ───────────────────────────────────────────

export interface RegisterNumberArgs {
  /** E.164 phone number Twilio already owns on the configured account. */
  twilioPhoneNumber: string
  /**
   * Twilio Account SID Vapi will use to place outbound + receive
   * inbound calls. Vapi proxies through this account, so it MUST be
   * the same SID that purchased the number — Vapi stores it but
   * does NOT verify ownership at registration time.
   */
  twilioAccountSid: string
  twilioAuthToken:  string
  /**
   * Vapi assistant id this number is bound to for INBOUND calls.
   * When a patient dials the number, Vapi routes the call to this
   * assistant's serverUrl. The reminder assistant id lives on a
   * different Vapi phone-number resource? No — there's only one
   * Vapi phone-number per E.164. The reminder bot is used via
   * assistantId in POST /call where this phone-number is the
   * placing party. So this field always references the INBOUND
   * receptionist (organizations.call_agent_assistant_id).
   */
  assistantId: string
  /** Human-friendly label, shown in the Vapi dashboard. */
  name: string
}

export interface VapiPhoneNumberResource {
  id:           string
  number:       string
  assistantId?: string | null
  name?:        string | null
}

/**
 * POST https://api.vapi.ai/phone-number
 *
 * NOT idempotent — see module docstring. Throws VapiApiError on
 * non-2xx; the caller is expected to inspect .status (typically 409
 * or 400 for the "already registered" case) and follow up with
 * getNumber() / a GET-by-number query to recover the existing id.
 */
export async function registerNumber(args: RegisterNumberArgs): Promise<VapiPhoneNumberResource> {
  if (!/^\+[1-9]\d{6,14}$/.test(args.twilioPhoneNumber)) {
    throw new Error(`vapi_register_invalid_e164: ${args.twilioPhoneNumber}`)
  }
  const body = {
    provider:         'twilio',
    twilioAccountSid: args.twilioAccountSid,
    twilioAuthToken:  args.twilioAuthToken,
    number:           args.twilioPhoneNumber,
    name:             args.name,
    assistantId:      args.assistantId,
  }
  const res = await fetch(`${VAPI_BASE}/phone-number`, {
    method: 'POST',
    headers: {
      Authorization:  getAuthHeader(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) return throwForBadResponse(res, 'vapi_register_phone_number')

  const json = await res.json() as VapiPhoneNumberResource
  if (!json.id) {
    throw new VapiApiError('vapi_register_phone_number returned 2xx but missing id', res.status, '')
  }
  return json
}

// ── 2. unregisterNumber ─────────────────────────────────────────

export interface UnregisterNumberArgs {
  vapiPhoneNumberId: string
}

/**
 * DELETE https://api.vapi.ai/phone-number/{id}
 *
 * 404 is treated as success so re-running the un-onboarding step
 * is safe. Used by the churn path (org cancels) and by the M5
 * rollback step if a later step in the pipeline fails after Vapi
 * registration succeeded.
 */
export async function unregisterNumber(args: UnregisterNumberArgs): Promise<void> {
  if (!args.vapiPhoneNumberId) throw new Error('vapi_unregister_missing_id')
  const res = await fetch(`${VAPI_BASE}/phone-number/${encodeURIComponent(args.vapiPhoneNumberId)}`, {
    method: 'DELETE',
    headers: { Authorization: getAuthHeader() },
  })
  if (res.ok || res.status === 404) return
  return throwForBadResponse(res, 'vapi_unregister_phone_number')
}

// ── 3. updateBinding ────────────────────────────────────────────

export interface UpdateBindingArgs {
  vapiPhoneNumberId: string
  /** New assistant id to bind for inbound calls. */
  assistantId: string
}

/**
 * PATCH https://api.vapi.ai/phone-number/{id}
 *
 * Used when an org re-seeds their inbound assistant (e.g. the
 * receptionist prompt changes and seed-vapi-assistant.ts mints a new
 * id). The M5 pipeline writes the new id to
 * organizations.call_agent_assistant_id and then calls this to
 * re-point the phone-number resource.
 */
export async function updateBinding(args: UpdateBindingArgs): Promise<VapiPhoneNumberResource> {
  if (!args.vapiPhoneNumberId) throw new Error('vapi_update_missing_id')
  if (!args.assistantId)       throw new Error('vapi_update_missing_assistant_id')
  const res = await fetch(`${VAPI_BASE}/phone-number/${encodeURIComponent(args.vapiPhoneNumberId)}`, {
    method: 'PATCH',
    headers: {
      Authorization:  getAuthHeader(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ assistantId: args.assistantId }),
  })
  if (!res.ok) return throwForBadResponse(res, 'vapi_update_phone_number')

  const json = await res.json() as VapiPhoneNumberResource
  if (!json.id) {
    throw new VapiApiError('vapi_update_phone_number returned 2xx but missing id', res.status, '')
  }
  return json
}

// ── 4. getNumber ────────────────────────────────────────────────

export interface GetNumberArgs {
  vapiPhoneNumberId: string
}

/**
 * GET https://api.vapi.ai/phone-number/{id}
 *
 * Used by the vapi-health route to verify the bound assistantId
 * still matches organizations.call_agent_assistant_id, and by the
 * M2 admin search/provision endpoints to surface a number's current
 * Vapi binding to the operator.
 */
export async function getNumber(args: GetNumberArgs): Promise<VapiPhoneNumberResource> {
  if (!args.vapiPhoneNumberId) throw new Error('vapi_get_missing_id')
  const res = await fetch(`${VAPI_BASE}/phone-number/${encodeURIComponent(args.vapiPhoneNumberId)}`, {
    headers: { Authorization: getAuthHeader() },
  })
  if (!res.ok) return throwForBadResponse(res, 'vapi_get_phone_number')

  const json = await res.json() as VapiPhoneNumberResource
  if (!json.id) {
    throw new VapiApiError('vapi_get_phone_number returned 2xx but missing id', res.status, '')
  }
  return json
}
