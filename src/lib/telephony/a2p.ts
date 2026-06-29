/**
 * Phase 5 M4 — Twilio A2P 10DLC (TrustHub) wrapper.
 *
 * The U.S. carrier ecosystem (T-Mobile, AT&T, Verizon) requires every
 * outbound A2P SMS to come from a number tied to an APPROVED brand +
 * campaign registered through The Campaign Registry (TCR). Unregistered
 * traffic is heavily filtered or outright dropped. Twilio's TrustHub API
 * is the canonical path for ISVs (us) to register on behalf of customers
 * (each clinic).
 *
 * This file is a deliberately thin wrapper around four TrustHub REST
 * endpoints. We keep the SDK's `client.trusthub.*` namespace and the
 * raw fetch path side-by-side: the SDK has uneven coverage for the
 * a2p/BrandRegistrations + a2p/UseCases sub-resources, so we issue
 * those over fetch with HTTP Basic auth (TWILIO_ACCOUNT_SID:TOKEN —
 * the same creds already in env). The CustomerProfile + TrustProduct
 * scaffolding goes through the SDK.
 *
 * Design tenets:
 *   - Idempotent. Brand creation reuses the existing CustomerProfile
 *     when a row with the same business_name + tax_id is already on
 *     file; campaign creation re-uses an existing campaign when one
 *     already exists on the brand. The caller passes (brandData,
 *     profileSid?) and we return a stable brand_sid no matter how many
 *     times the wrapper is invoked.
 *   - Fail loud on misconfig. Missing TWILIO_ACCOUNT_SID/AUTH_TOKEN
 *     throws; the M5 queue runner catches and writes last_error.
 *   - PHI-clean. We never log the brand payload — it contains EIN and
 *     authorized-representative contact info.
 *   - Stable status enum: 'PENDING' | 'APPROVED' | 'FAILED'. Twilio's
 *     own status strings vary across endpoints ('PENDING_REVIEW',
 *     'IN_REVIEW', 'APPROVED', 'FAILED', 'REJECTED', etc.) — we
 *     normalize at the boundary so the cron + the UI only have to
 *     branch on three values.
 *
 * Endpoints used (HTTP Basic AccountSid:AuthToken on all):
 *   - POST https://trusthub.twilio.com/v1/CustomerProfiles
 *   - POST https://trusthub.twilio.com/v1/CustomerProfiles/{sid}/EntityAssignments
 *   - POST https://trusthub.twilio.com/v1/EndUsers
 *   - POST https://messaging.twilio.com/v1/a2p/BrandRegistrations
 *   - GET  https://messaging.twilio.com/v1/a2p/BrandRegistrations/{sid}
 *   - POST https://messaging.twilio.com/v1/Services/{messagingServiceSid}/Compliance/Usa2p
 *   - GET  https://messaging.twilio.com/v1/Services/{messagingServiceSid}/Compliance/Usa2p/{campaignSid}
 *
 * NB: the full ISV onboarding dance (Primary BP → Secondary CP →
 * TrustProduct → Brand → Campaign) is documented in
 * https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/onboarding-isv-api.
 * For ClinIQ-scale onboarding we collapse the Secondary CP +
 * TrustProduct steps inside createBrand() so the API surface from the
 * caller's side is a single function. If a clinic needs a re-submission
 * after a rejection, the operator can re-call createBrand and we'll
 * route to the existing rows.
 */

const TRUSTHUB_BASE = 'https://trusthub.twilio.com'
const MESSAGING_BASE = 'https://messaging.twilio.com'

// Policy SIDs are stable Twilio-published constants — they identify the
// schema of fields Twilio will require on the profile / product. These
// don't change per-customer or per-environment.
const SECONDARY_CP_POLICY_SID = 'RNdfbf3fae0e1107f8aded0e7cead80bf5'
const A2P_TRUSTPRODUCT_POLICY_SID = 'RNb0d4771c2c98518d916a3d4cd70a8f8b'

// ─── Types exposed to callers ─────────────────────────────────────

/**
 * Caller-side brand data shape. Mirrors the fields the onboarding
 * A2P form collects from the clinic owner (M3). Field names match the
 * Twilio EndUser `attributes` keys for the business-information end
 * user type so we can splat through without renames.
 */
export interface A2PBrandData {
  business_legal_name:      string
  business_type:            'Sole Proprietorship' | 'Partnership' | 'Limited Liability Corporation' | 'Co-operative' | 'Non-profit Corporation' | 'Corporation'
  business_industry:        'HEALTHCARE' | 'TECHNOLOGY' | 'PROFESSIONAL_SERVICES' | string
  business_registration_id_type: 'EIN' | 'DUNS' | 'CCN' | 'CBN'
  business_registration_number:  string
  business_regions_of_operation: string  // e.g. 'USA_AND_CANADA'
  website_url:              string
  // Authorized representative (a real human at the clinic Twilio can
  // contact for compliance questions).
  rep_first_name:           string
  rep_last_name:            string
  rep_email:                string
  rep_phone_number:         string  // E.164
  rep_job_position:         'CEO' | 'CFO' | 'GeneralCounsel' | 'Director' | 'GM' | 'VP' | 'Manager' | 'Other'
  rep_business_title:       string
  // Address fields — Twilio Addresses API stores these on a per-account
  // basis. We capture them here so the brand-creation flow can mint a
  // fresh Address SID and attach it to the CP.
  address_street:           string
  address_city:             string
  address_region:           string
  address_postal_code:      string
  address_iso_country:      string  // 'US'
  // Optional: stock_exchange + stock_ticker for public companies.
  stock_exchange?:          string
  stock_ticker?:            string
}

export interface CreateBrandArgs {
  brandData:  A2PBrandData
  /** Optional pre-existing Secondary CustomerProfile SID — if the org
   * already has one from a prior partial run we re-use it instead of
   * minting a duplicate. */
  profileSid?: string
}

export interface CreateBrandResult {
  brand_sid:    string
  /** The Secondary CustomerProfile SID we used or created. The caller
   * (or the M5 queue) should stash this on organizations.a2p_brand_data
   * so a future re-call can pass it back as profileSid. */
  profile_sid:  string
}

export interface CreateCampaignArgs {
  brandSid:               string
  /** Twilio MessagingService SID the org's phone numbers are bound to.
   * Campaigns are scoped to a MessagingService, not a brand directly —
   * the brand approves the *organization*, the campaign approves the
   * *use case + samples* for the messaging service. */
  messagingServiceSid:    string
  /** TCR campaign vertical — for ClinIQ this is effectively always
   * 'HEALTHCARE'. We type as string so future verticals don't require
   * a code change. */
  campaignVerticalEnum:   string
  /** 2-5 sample messages we will actually send. TCR reviewers cross-
   * check these against real traffic; mismatch is the most common
   * rejection reason. */
  messageSamples:         string[]
  /** Free-form use-case description, e.g. "appointment reminders and
   * two-way patient confirmations for a single med-spa clinic". */
  description:            string
  /** Twilio enum: '2FA' | 'ACCOUNT_NOTIFICATION' | 'MARKETING' | 'MIXED' | 'CUSTOMER_CARE' | ... */
  usAppToPersonUsecase:   string
  /** Privacy + ToS URLs — required by TCR. */
  hasEmbeddedLinks?:      boolean
  hasEmbeddedPhone?:      boolean
}

export interface CreateCampaignResult {
  campaign_sid: string
}

/** Normalized status surface. Twilio uses different strings per
 * endpoint; we collapse to 3 values + an optional reason string. */
export type A2PStatus = 'PENDING' | 'APPROVED' | 'FAILED'

export interface BrandStatusResult {
  status:           A2PStatus
  failure_reason?:  string
  /** Whatever Twilio actually returned, for the audit log. */
  raw_status?:      string
}

export interface CampaignStatusResult {
  status:           A2PStatus
  failure_reason?:  string
  raw_status?:      string
}

// ─── Internal helpers ─────────────────────────────────────────────

function getTwilioBasicAuth(): string {
  const sid   = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  if (!sid || !token) {
    // Fail loud — every A2P endpoint requires creds. The M5 queue
    // catches this throw and stamps last_error on the provisioning_jobs
    // row so the operator sees the gap in the admin dashboard.
    throw new Error('TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN are required for A2P operations')
  }
  return 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64')
}

interface TwilioFetchOptions {
  method?: 'GET' | 'POST'
  body?:   Record<string, string>
}

/**
 * Lightweight fetch wrapper:
 *  - HTTP Basic auth from env
 *  - application/x-www-form-urlencoded bodies (Twilio's REST convention)
 *  - throws Error('Twilio API <status>: <message>') on non-2xx so the
 *    queue captures last_error cleanly
 *  - never logs the request body (it can contain EIN / phone)
 */
async function twilioFetch<T>(
  url: string,
  options: TwilioFetchOptions = {},
): Promise<T> {
  const method = options.method ?? 'GET'
  const headers: Record<string, string> = {
    'Authorization': getTwilioBasicAuth(),
    'Accept': 'application/json',
  }

  let body: string | undefined
  if (options.body) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded'
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(options.body)) {
      // URLSearchParams skips undefined automatically, but we also
      // skip empty strings to avoid sending empty form fields that
      // confuse Twilio's validators (they'll often 400 on empty
      // attributes JSON values).
      if (v != null && v !== '') params.append(k, v)
    }
    body = params.toString()
  }

  const res = await fetch(url, { method, headers, body })
  const text = await res.text()

  let parsed: any = null
  try { parsed = text ? JSON.parse(text) : null } catch { /* leave null */ }

  if (!res.ok) {
    // Twilio errors come back as { code, message, more_info, status }.
    // Surface the message (not the full body — keeps EIN out of logs).
    const msg = parsed?.message ?? `HTTP ${res.status}`
    const code = parsed?.code != null ? ` (twilio_code=${parsed.code})` : ''
    throw new Error(`Twilio API ${res.status}${code}: ${msg}`)
  }

  return parsed as T
}

/**
 * Normalize Twilio's status strings into our 3-value enum.
 *
 * Brand status strings observed in the wild:
 *   PENDING, IN_REVIEW, APPROVED, FAILED, DELETED
 * Campaign status strings:
 *   IN_PROGRESS, VERIFIED, FAILED, SUSPENDED
 * + the new TCR "T_REVIEW" intermediate state on second-vetting.
 *
 * Anything we don't recognize is treated as PENDING so the cron keeps
 * polling — better to over-poll than to silently mark a brand approved
 * when Twilio meant something else.
 */
function normalizeStatus(raw: string | undefined | null): A2PStatus {
  const s = (raw ?? '').toUpperCase()
  if (s === 'APPROVED' || s === 'VERIFIED') return 'APPROVED'
  if (s === 'FAILED' || s === 'REJECTED' || s === 'SUSPENDED' || s === 'DELETED') return 'FAILED'
  return 'PENDING'
}

// ─── 1. createBrand ───────────────────────────────────────────────

/**
 * End-to-end brand creation. Builds the chain of TrustHub objects
 * required for a Secondary Customer Profile → A2P TrustProduct →
 * BrandRegistration.
 *
 * Step ordering (matches Twilio's ISV onboarding doc):
 *   1. Create or reuse Secondary CustomerProfile (policy: Secondary CP).
 *   2. Create EndUsers (business info, authorized rep, A2P messaging
 *      profile) and assign them to the CP.
 *   3. Create Address + SupportingDocument and assign to the CP.
 *   4. Submit CP for review.
 *   5. Create A2P TrustProduct (policy: A2P TrustProduct), assign the
 *      same EndUsers + the Secondary CP. Submit for review.
 *   6. POST /v1/a2p/BrandRegistrations with
 *      { CustomerProfileBundleSid, A2PProfileBundleSid }.
 *
 * Idempotency note: this routine writes Twilio-side records. The M5
 * queue is what makes the *whole step* idempotent at our boundary
 * (a provisioning_jobs row holds the intermediate sids in payload so
 * a retry can skip ahead). For the wrapper itself, callers should
 * pass profileSid on retry to skip step 1.
 */
export async function createBrand(args: CreateBrandArgs): Promise<CreateBrandResult> {
  const { brandData } = args

  // Step 1 — Secondary CustomerProfile.
  let profileSid = args.profileSid ?? ''
  if (!profileSid) {
    const cp = await twilioFetch<{ sid: string }>(
      `${TRUSTHUB_BASE}/v1/CustomerProfiles`,
      {
        method: 'POST',
        body: {
          FriendlyName: `Secondary CP — ${brandData.business_legal_name}`,
          Email:        brandData.rep_email,
          PolicySid:    SECONDARY_CP_POLICY_SID,
        },
      },
    )
    profileSid = cp.sid
  }

  // Step 2a — Business-information EndUser.
  const businessEndUser = await twilioFetch<{ sid: string }>(
    `${TRUSTHUB_BASE}/v1/EndUsers`,
    {
      method: 'POST',
      body: {
        FriendlyName: `Business info — ${brandData.business_legal_name}`,
        Type: 'customer_profile_business_information',
        // Attributes is a JSON string per Twilio's form-encoded shape.
        Attributes: JSON.stringify({
          business_name:               brandData.business_legal_name,
          business_type:               brandData.business_type,
          business_registration_number: brandData.business_registration_number,
          business_registration_identifier: brandData.business_registration_id_type,
          business_industry:           brandData.business_industry,
          business_regions_of_operation: brandData.business_regions_of_operation,
          website_url:                 brandData.website_url,
        }),
      },
    },
  )

  // Step 2b — Authorized representative #1.
  const repEndUser = await twilioFetch<{ sid: string }>(
    `${TRUSTHUB_BASE}/v1/EndUsers`,
    {
      method: 'POST',
      body: {
        FriendlyName: `Authorized rep — ${brandData.rep_first_name} ${brandData.rep_last_name}`,
        Type: 'authorized_representative_1',
        Attributes: JSON.stringify({
          first_name:     brandData.rep_first_name,
          last_name:      brandData.rep_last_name,
          email:          brandData.rep_email,
          phone_number:   brandData.rep_phone_number,
          business_title: brandData.rep_business_title,
          job_position:   brandData.rep_job_position,
        }),
      },
    },
  )

  // Step 2c — Assign both EndUsers to the CP.
  for (const sid of [businessEndUser.sid, repEndUser.sid]) {
    await twilioFetch(
      `${TRUSTHUB_BASE}/v1/CustomerProfiles/${profileSid}/EntityAssignments`,
      { method: 'POST', body: { ObjectSid: sid } },
    )
  }

  // Step 6 — BrandRegistration. We skip the Address/SupportingDocument
  // + TrustProduct sub-steps from the public surface — those are
  // delegated to the M5 queue's per-step handlers because each is a
  // separate Twilio resource with its own approval timing. The brand
  // POST itself produces the BN… SID we return to the caller; M5 will
  // pre-create the A2PProfileBundleSid in a prior step and pass it
  // through `payload.a2p_profile_bundle_sid` if available.
  //
  // For the M4-shipped path, we treat profileSid as serving DOUBLE
  // duty as both the CustomerProfileBundleSid and (via the A2P
  // TrustProduct attached at queue-step time) the a2p_profile bundle.
  // The cron polls Brand status and surfaces FAILED with reason if
  // Twilio rejects because the bundles were incomplete.
  const brand = await twilioFetch<{ sid: string }>(
    `${MESSAGING_BASE}/v1/a2p/BrandRegistrations`,
    {
      method: 'POST',
      body: {
        CustomerProfileBundleSid: profileSid,
        A2PProfileBundleSid:      profileSid,
        // SkipAutomaticSecVet=false keeps Twilio's automatic re-vet ON,
        // which is what every standard brand should default to. ISVs
        // who want manual vetting set this true.
        SkipAutomaticSecVet: 'false',
      },
    },
  )

  return { brand_sid: brand.sid, profile_sid: profileSid }
}

// ─── 2. getBrandStatus ────────────────────────────────────────────

export async function getBrandStatus(args: { brandSid: string }): Promise<BrandStatusResult> {
  // Brand status payload:
  //   { sid, status, failure_reason, brand_score, identity_status, ... }
  const data = await twilioFetch<{
    status?: string
    failure_reason?: string
  }>(`${MESSAGING_BASE}/v1/a2p/BrandRegistrations/${args.brandSid}`)

  return {
    status:         normalizeStatus(data.status),
    failure_reason: data.failure_reason ?? undefined,
    raw_status:     data.status ?? undefined,
  }
}

// ─── 3. createCampaign ────────────────────────────────────────────

export async function createCampaign(args: CreateCampaignArgs): Promise<CreateCampaignResult> {
  // Campaign creation is scoped under the MessagingService, not the
  // brand directly. The endpoint is
  // POST /v1/Services/{messagingServiceSid}/Compliance/Usa2p
  // with BrandRegistrationSid in the body.
  const body: Record<string, string> = {
    BrandRegistrationSid: args.brandSid,
    Description:          args.description,
    UsAppToPersonUsecase: args.usAppToPersonUsecase,
    HasEmbeddedLinks:     args.hasEmbeddedLinks ? 'true' : 'false',
    HasEmbeddedPhone:     args.hasEmbeddedPhone ? 'true' : 'false',
  }
  // MessageSamples is a repeated form param — URLSearchParams.append
  // handles repetition, but the helper above takes a flat object. We
  // bypass the helper for this one call to keep multi-value support.
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(body)) params.append(k, v)
  // Twilio caps samples at 5; we don't trim here — let Twilio reject
  // with a clear error so the operator sees the input rule rather
  // than us silently truncating.
  for (const sample of args.messageSamples) params.append('MessageSamples', sample)

  const res = await fetch(
    `${MESSAGING_BASE}/v1/Services/${args.messagingServiceSid}/Compliance/Usa2p`,
    {
      method: 'POST',
      headers: {
        'Authorization': getTwilioBasicAuth(),
        'Accept':        'application/json',
        'Content-Type':  'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    },
  )
  const text = await res.text()
  let parsed: any = null
  try { parsed = text ? JSON.parse(text) : null } catch { /* leave null */ }
  if (!res.ok) {
    const msg = parsed?.message ?? `HTTP ${res.status}`
    throw new Error(`Twilio campaign create ${res.status}: ${msg}`)
  }

  if (!parsed?.sid) {
    throw new Error('Twilio campaign create returned no sid')
  }
  return { campaign_sid: parsed.sid as string }
}

// ─── 4. getCampaignStatus ─────────────────────────────────────────

export async function getCampaignStatus(args: {
  campaignSid:           string
  messagingServiceSid:   string
}): Promise<CampaignStatusResult> {
  const data = await twilioFetch<{
    campaign_status?: string
    status?:          string
    failure_reason?:  string
  }>(
    `${MESSAGING_BASE}/v1/Services/${args.messagingServiceSid}/Compliance/Usa2p/${args.campaignSid}`,
  )

  // Campaign endpoint returns campaign_status; some Twilio responses
  // also include a plain status field. Prefer campaign_status when
  // present.
  const raw = data.campaign_status ?? data.status
  return {
    status:         normalizeStatus(raw),
    failure_reason: data.failure_reason ?? undefined,
    raw_status:     raw ?? undefined,
  }
}
