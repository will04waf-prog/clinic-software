/**
 * Phase 5 M2 — Twilio phone-number REST wrappers.
 *
 * Pure fetch-based wrappers around the AvailablePhoneNumbers,
 * IncomingPhoneNumbers, and DELETE /IncomingPhoneNumbers/{Sid}
 * endpoints. We deliberately do NOT route through the twilio-node
 * SDK here (even though it's a dep via src/lib/twilio.ts) because:
 *
 *   1. The provisioning surface is small and the SDK's resource
 *      shapes drift across major versions — the REST contract is
 *      stable. Keeping the wire format in our hands makes the
 *      retry/recovery branches in scripts/provision-clinic-phone.ts
 *      and the M5 step handlers easier to reason about.
 *   2. The error envelope from Twilio's REST API ({ code, message,
 *      status, more_info }) is what shows up in the super-admin
 *      dashboard and in provisioning_jobs.last_error. Working from
 *      the SDK error subclasses adds an indirection we don't want
 *      when the operator is trying to read a stuck job.
 *   3. The DELETE endpoint just returns 204; the SDK's typed return
 *      for that case is awkward (Promise<boolean>) vs. our explicit
 *      throw-on-non-2xx contract.
 *
 * Auth: HTTP Basic with TWILIO_ACCOUNT_SID:TWILIO_AUTH_TOKEN — the
 * same creds already wired up for sendSMS. We re-read process.env on
 * every call (no module-scope capture) so the test harness can swap
 * the values per-test.
 *
 * Errors: every non-2xx is thrown as a TwilioApiError that carries
 * the parsed Twilio error code (e.g. 21422 "PhoneNumber is invalid")
 * so the M5 step handlers can branch on retryable vs. terminal
 * codes without re-parsing the message string.
 *
 * Idempotency: POST /IncomingPhoneNumbers.json is idempotent on
 * (AccountSid, PhoneNumber) — Twilio returns the existing SID with
 * a 201 if the account already owns the number. The wrapper
 * surfaces that as a normal success.
 */

// ── Auth + base URL helpers ─────────────────────────────────────

const TWILIO_BASE = 'https://api.twilio.com/2010-04-01'

function getAuthHeader(): string {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  if (!sid || !token) {
    // Throwing (rather than returning null) is intentional. These
    // helpers are only reached after isTwilioConfigured() has
    // already gated, so a missing env here is a deployment bug,
    // not a user-input error.
    throw new Error('twilio_credentials_missing')
  }
  return 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64')
}

function getAccountSid(): string {
  const sid = process.env.TWILIO_ACCOUNT_SID
  if (!sid) throw new Error('twilio_credentials_missing')
  return sid
}

/**
 * Typed Twilio API error. The `code` field is Twilio's numeric error
 * code (e.g. 20003 auth, 21422 invalid phone, 21452 no numbers
 * available) — see https://www.twilio.com/docs/api/errors. Callers
 * can branch on it without parsing the message.
 */
export class TwilioApiError extends Error {
  readonly status: number
  readonly code:   number | null
  readonly moreInfo: string | null
  constructor(message: string, status: number, code: number | null, moreInfo: string | null) {
    super(message)
    this.name = 'TwilioApiError'
    this.status = status
    this.code = code
    this.moreInfo = moreInfo
  }
}

async function throwForBadResponse(res: Response, op: string): Promise<never> {
  // Twilio error responses are JSON: { code, message, status, more_info }.
  // We don't trust the body to be valid JSON in every failure mode
  // (e.g. a Cloudflare 502 in front of Twilio) so we catch parse
  // errors and fall back to the raw text.
  let code: number | null = null
  let message = `${op} failed: HTTP ${res.status}`
  let moreInfo: string | null = null
  try {
    const json = await res.json() as { code?: number; message?: string; more_info?: string }
    if (typeof json.code === 'number') code = json.code
    if (typeof json.message === 'string') message = `${op} failed (twilio code ${json.code ?? '?'}): ${json.message}`
    if (typeof json.more_info === 'string') moreInfo = json.more_info
  } catch {
    const text = await res.text().catch(() => '')
    if (text) message += `: ${text.slice(0, 200)}`
  }
  throw new TwilioApiError(message, res.status, code, moreInfo)
}

// ── 1. searchAvailableLocal ─────────────────────────────────────

export interface AvailablePhoneNumberCapabilities {
  voice: boolean
  sms:   boolean
  mms:   boolean
}

export interface AvailablePhoneNumber {
  e164:         string
  friendlyName: string
  region:       string | null
  locality:     string | null
  capabilities: AvailablePhoneNumberCapabilities
}

export interface SearchAvailableLocalArgs {
  /** ISO-3166-1 alpha-2 country code. Defaults to 'US'. */
  countryCode?: string
  /** Local area code (3-digit for US/CA). */
  areaCode?: string
  /** Vanity pattern with Twilio wildcards (* / %). */
  contains?: string
  /** Limit response size — Twilio defaults to 50, max 50. */
  limit?: number
}

/**
 * GET /2010-04-01/Accounts/{Sid}/AvailablePhoneNumbers/{Country}/Local.json
 *
 * Returns up to `limit` SMS+voice capable numbers for the requested
 * area code. We require both capabilities at the search layer so the
 * UI never offers a voice-only or SMS-only number that would later
 * fail at Vapi-binding time (Vapi requires voice; we require SMS for
 * confirmations + STOP handling).
 */
export async function searchAvailableLocal(
  args: SearchAvailableLocalArgs,
): Promise<AvailablePhoneNumber[]> {
  const country = (args.countryCode ?? 'US').toUpperCase()
  const url = new URL(`${TWILIO_BASE}/Accounts/${getAccountSid()}/AvailablePhoneNumbers/${country}/Local.json`)

  if (args.areaCode) url.searchParams.set('AreaCode', args.areaCode)
  if (args.contains) url.searchParams.set('Contains', args.contains)
  // Force voice + sms capabilities. mms is preferred but not required —
  // most US local numbers carry MMS today but a few rural ranges don't,
  // and we never want to fail a search over MMS.
  url.searchParams.set('VoiceEnabled', 'true')
  url.searchParams.set('SmsEnabled',   'true')
  // Twilio caps PageSize at 50 — we clamp to 20 by default to keep the
  // payload small in the UI.
  const limit = Math.max(1, Math.min(50, args.limit ?? 20))
  url.searchParams.set('PageSize', String(limit))

  const res = await fetch(url.toString(), { headers: { Authorization: getAuthHeader() } })
  if (!res.ok) return throwForBadResponse(res, 'twilio_search_available')

  // Twilio JSON shape: { available_phone_numbers: [{ phone_number,
  // friendly_name, region, locality, capabilities: { voice, sms, MMS } }] }
  const json = await res.json() as {
    available_phone_numbers?: Array<{
      phone_number:  string
      friendly_name: string
      region:        string | null
      locality:      string | null
      capabilities?: { voice?: boolean; SMS?: boolean; MMS?: boolean }
    }>
  }

  return (json.available_phone_numbers ?? []).map(row => ({
    e164:         row.phone_number,
    friendlyName: row.friendly_name,
    region:       row.region   ?? null,
    locality:     row.locality ?? null,
    capabilities: {
      voice: !!row.capabilities?.voice,
      sms:   !!row.capabilities?.SMS,
      mms:   !!row.capabilities?.MMS,
    },
  }))
}

// ── 2. purchaseNumber ───────────────────────────────────────────

export interface PurchaseNumberArgs {
  e164:         string
  friendlyName?: string
  /** Twilio AddressSid (AD...) — required for some countries; optional for US. */
  addressSid?:   string
}

export interface PurchasedNumber {
  sid:  string
  e164: string
}

/**
 * POST /2010-04-01/Accounts/{Sid}/IncomingPhoneNumbers.json
 *
 * Idempotency: Twilio returns the existing IncomingPhoneNumber row
 * (with a 201) if the account already owns this number, so a retry
 * from a stuck provisioning_jobs row does NOT double-charge. The
 * surfaced shape ({ sid, e164 }) is the same on first-buy vs.
 * already-owned, so the M5 step handler doesn't need to branch.
 *
 * Voice + SMS URLs are intentionally NOT set here. The M5 pipeline
 * later attaches the number to a Vapi phone-number resource which
 * REWRITES the voice webhook to Vapi's edge. Setting voiceUrl here
 * would just be transient noise. The SMS webhook is set by M4 when
 * the MessagingService is attached for A2P.
 */
export async function purchaseNumber(args: PurchaseNumberArgs): Promise<PurchasedNumber> {
  if (!/^\+[1-9]\d{6,14}$/.test(args.e164)) {
    throw new Error(`purchase_number_invalid_e164: ${args.e164}`)
  }
  const url = `${TWILIO_BASE}/Accounts/${getAccountSid()}/IncomingPhoneNumbers.json`
  const form = new URLSearchParams()
  form.set('PhoneNumber', args.e164)
  if (args.friendlyName) form.set('FriendlyName', args.friendlyName)
  if (args.addressSid)   form.set('AddressSid',   args.addressSid)

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization:  getAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  })
  if (!res.ok) return throwForBadResponse(res, 'twilio_purchase_number')

  const json = await res.json() as { sid?: string; phone_number?: string }
  if (!json.sid || !json.phone_number) {
    throw new TwilioApiError('twilio_purchase_number returned 2xx but missing sid/phone_number', res.status, null, null)
  }
  return { sid: json.sid, e164: json.phone_number }
}

// ── 3. releaseNumber ────────────────────────────────────────────

export interface ReleaseNumberArgs {
  sid: string
}

/**
 * DELETE /2010-04-01/Accounts/{Sid}/IncomingPhoneNumbers/{Sid}.json
 *
 * Used by the un-onboarding / churn path. Twilio returns 204 on
 * success. 404 is treated as success (the number is already gone)
 * to keep the un-onboarding script idempotent.
 */
export async function releaseNumber(args: ReleaseNumberArgs): Promise<void> {
  if (!args.sid) throw new Error('release_number_missing_sid')
  const url = `${TWILIO_BASE}/Accounts/${getAccountSid()}/IncomingPhoneNumbers/${args.sid}.json`

  const res = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: getAuthHeader() },
  })
  if (res.status === 204 || res.status === 404) return
  return throwForBadResponse(res, 'twilio_release_number')
}
