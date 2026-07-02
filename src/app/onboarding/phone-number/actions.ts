/**
 * Phase 5 M3 — server actions backing the phone-number onboarding flow.
 *
 * Three actions exposed:
 *   1. searchNumbersAction({ areaCode, country }) — searches Twilio's
 *      AvailablePhoneNumbers via M2's /api/admin/numbers/search route.
 *   2. provisionNumberAction({ e164, brandData }) — atomically stamps
 *      organizations.a2p_brand_data and enqueues the provisioning chain
 *      via M2's /api/admin/numbers/provision route. The chain itself
 *      (buy_twilio_number → register_vapi_phone → register_a2p_brand →
 *      register_a2p_campaign) is drained by M5's cron runner; this
 *      action only kicks it off and returns the lead job_id so the UI
 *      can begin polling.
 *   3. getProvisioningStatusAction({}) — reads provisioning_jobs for
 *      the caller's org and returns one row per canonical step,
 *      preferring the most recent row per step. Used by the progress
 *      stepper that polls every 2s.
 *
 * Why all three are owner-only:
 *   - Search costs nothing on Twilio's side but exposes inventory that
 *     non-owners shouldn't see surface-area on. More importantly the
 *     buy step is owner-only (real money, real long-lived obligation),
 *     so keeping search owner-only too means there's no "look but
 *     can't touch" half-state where a staff user sees numbers they
 *     can't claim.
 *   - Status read is owner-only because the provisioning_jobs RLS
 *     policy is already owner-only by org (per M1 migration). The
 *     gate here just gives a clean 403 instead of an empty array
 *     when a staff session somehow calls the action.
 *
 * These actions call the shared service in
 * src/lib/telephony/number-provisioning-service.ts DIRECTLY — the
 * same core the M2 HTTP routes wrap — after running their own
 * requireRole(OWNER_ONLY) gate. They used to round-trip through the
 * M2 routes over HTTPS with hand-forwarded cookies; that hop 401'd
 * whenever anything dropped the Cookie header (e.g. a www→apex 307,
 * on which fetch strips cookies per the cross-origin redirect rule),
 * dead-ending owners at the number picker with a raw
 * {"error":"Unauthorized"}. In-process calls can't lose the session.
 */

'use server'

import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isDenied, OWNER_ONLY, requireRole } from '@/lib/auth/roles'
import { searchNumbersForOrg, provisionNumberForOrg } from '@/lib/telephony/number-provisioning-service'
// Step taxonomy + the plain types/interfaces live in ./steps.ts —
// a 'use server' file may only export async functions, so the
// PROVISIONING_STEPS const (a runtime value) cannot be exported here.
import {
  PROVISIONING_STEPS,
  type ProvisioningJobStatus,
  type NumberSearchResult,
  type ProvisioningStepRow,
} from './steps'

// ── Input validation ──────────────────────────────────────────────
//
// Zod schemas live at the action boundary, not inside the components,
// so a malicious client posting straight to the action endpoint can't
// skip validation. Tight regex + closed enums keep the surface
// auditable.
const searchInputSchema = z.object({
  // 3-digit US/CA NPA. Other ISO countries don't use NPAs; if/when we
  // open up international we'll branch on country first.
  areaCode: z.string().regex(/^\d{3}$/, 'Area code must be 3 digits'),
  country:  z.enum(['US', 'CA']).default('US'),
})

const brandDataSchema = z.object({
  business_name:        z.string().min(1).max(200),
  dba:                  z.string().max(200).nullable().optional(),
  // EIN: 9 digits, optionally with the conventional hyphen XX-XXXXXXX.
  // Stored canonically as digits-only.
  ein:                  z.string().regex(/^\d{2}-?\d{7}$/, 'EIN must be 9 digits (e.g. 12-3456789)'),
  address_line1:        z.string().min(1).max(200),
  address_line2:        z.string().max(200).nullable().optional(),
  city:                 z.string().min(1).max(100),
  region:               z.string().min(1).max(100),
  postal_code:          z.string().min(1).max(20),
  country_code:         z.string().length(2).default('US'),
  website_url:          z.string().url().max(500),
  business_email:       z.string().email().max(200),
  business_phone:       z.string().regex(/^\+[1-9]\d{6,14}$/, 'Use E.164 format, e.g. +14155551234'),
  vertical:             z.enum(['medical', 'aesthetic', 'wellness']),
  sample_message:       z.string().min(20).max(1024),
})

const provisionInputSchema = z.object({
  e164:      z.string().regex(/^\+[1-9]\d{6,14}$/, 'Invalid phone number'),
  brandData: brandDataSchema,
})

// ── Action 1: searchNumbersAction ────────────────────────────────
export async function searchNumbersAction(
  input: { areaCode: string; country?: 'US' | 'CA' },
): Promise<
  | { ok: true;  numbers: NumberSearchResult[] }
  | { ok: false; error: string }
> {
  const parsed = searchInputSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in' }

  const gate = await requireRole(supabase, user.id, OWNER_ONLY)
  if (isDenied(gate)) return { ok: false, error: 'Only the clinic owner can search for numbers.' }

  const outcome = await searchNumbersForOrg(gate.orgId, {
    areaCode: parsed.data.areaCode,
    country:  parsed.data.country,
  })
  if (!outcome.ok) {
    return { ok: false, error: outcome.message ?? `Search failed (${outcome.error})` }
  }

  const numbers: NumberSearchResult[] = outcome.results.map(r => ({
    e164:          r.e164,
    friendly_name: r.friendlyName ?? r.e164,
    region:        r.region ?? undefined,
    locality:      r.locality ?? undefined,
    // Fresh literal: the UI type keeps a loose Record<string, boolean>
    // while the Twilio wrapper returns fixed-key capabilities.
    capabilities:  { voice: r.capabilities.voice, sms: r.capabilities.sms, mms: r.capabilities.mms },
  }))
  return { ok: true, numbers }
}

// ── Action 2: provisionNumberAction ──────────────────────────────
export async function provisionNumberAction(
  input: { e164: string; brandData: z.infer<typeof brandDataSchema> },
): Promise<
  | { ok: true;  job_id: string | null }
  | { ok: false; error: string }
> {
  const parsed = provisionInputSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in' }

  const gate = await requireRole(supabase, user.id, OWNER_ONLY)
  if (isDenied(gate)) return { ok: false, error: 'Only the clinic owner can buy a phone number.' }
  const { orgId } = gate

  // Stamp a2p_brand_data BEFORE kicking off provisioning so that if the
  // M2 route succeeds but the page is closed mid-flow, the M5 runner
  // (or a manual retry) can pick up the brand payload from the org row
  // without re-prompting the user. We normalise EIN to digits-only and
  // store the rest verbatim.
  //
  // Service-role write is safe here because the requireRole gate above
  // already authorized this user as the owner of orgId. Going through
  // the user session would require an /api/org/* PATCH; we'd rather
  // keep the brand payload write co-located with the provision action
  // so it's atomic from the caller's perspective.
  const ein = parsed.data.brandData.ein.replace(/-/g, '')
  const brandDataForStorage = {
    ...parsed.data.brandData,
    ein,                          // digits-only canonical form
    submitted_at: new Date().toISOString(),
  }

  const { error: stampErr } = await supabaseAdmin
    .from('organizations')
    .update({
      a2p_brand_data:        brandDataForStorage,
      a2p_status:            'pending',           // M4 cron will refine pending→approved/rejected
      a2p_status_updated_at: new Date().toISOString(),
    })
    .eq('id', orgId)

  if (stampErr) {
    return { ok: false, error: `Could not save brand data: ${stampErr.message}` }
  }

  // Enqueue the provisioning chain via the shared service (same core
  // the M2 route wraps). brand_data has already been stamped on the
  // org row above, so M4's a2p_brand_register step reads it from
  // there. Subsequent steps are chained by M5's runner.
  const outcome = await provisionNumberForOrg(orgId, parsed.data.e164, user.id)
  if (!outcome.ok) {
    return { ok: false, error: outcome.message ?? `Provisioning failed to start (${outcome.error})` }
  }
  return { ok: true, job_id: outcome.jobId }
}

// ── Action 3: getProvisioningStatusAction ────────────────────────
//
// Reads the most recent provisioning_jobs row PER STEP for the
// caller's org and returns the canonical 4-step taxonomy so the UI
// can render a fixed-shape stepper even if some steps haven't been
// enqueued yet (M5 chains them lazily, so the brand/campaign rows
// don't exist until upstream succeeds).
//
// Why "most recent per step" and not "active": a failed row is still
// useful to show — the stepper renders failed status + last_error so
// the owner can see WHY without us re-running the chain.
export async function getProvisioningStatusAction(): Promise<
  | { ok: true;  steps: ProvisioningStepRow[]; done: boolean }
  | { ok: false; error: string }
> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in' }

  const gate = await requireRole(supabase, user.id, OWNER_ONLY)
  if (isDenied(gate)) return { ok: false, error: 'Only the clinic owner can view provisioning status.' }
  const { orgId } = gate

  // Read all rows for this org, then collapse to "latest per step" in
  // JS. The table is bounded (one chain per org per attempt, retries
  // are bounded by M5) so doing this in JS is cheaper than a window
  // function on a partial index.
  const { data: rows, error: readErr } = await supabase
    .from('provisioning_jobs')
    .select('step, status, last_error, updated_at, created_at')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })

  if (readErr) {
    return { ok: false, error: readErr.message }
  }

  // Index by step name, keeping the first (= newest) row per step.
  const seen = new Map<string, { status: string; last_error: string | null; updated_at: string | null }>()
  for (const r of (rows ?? [])) {
    if (!seen.has(r.step)) {
      seen.set(r.step, {
        status:     r.status as string,
        last_error: r.last_error as string | null,
        updated_at: r.updated_at as string | null,
      })
    }
  }

  const steps: ProvisioningStepRow[] = PROVISIONING_STEPS.map(step => {
    const found = seen.get(step)
    if (!found) {
      return { step, status: 'not_started', last_error: null, updated_at: null }
    }
    return {
      step,
      status:     found.status as ProvisioningJobStatus,
      last_error: found.last_error,
      updated_at: found.updated_at,
    }
  })

  // The flow is "done" once vapi_phone_number_id is populated. We
  // could derive done from steps[1].status === 'succeeded' but reading
  // the org column is the source of truth that the page-load guard
  // also uses, so they stay in lockstep even if a step row gets pruned
  // by an operator.
  const { data: org } = await supabase
    .from('organizations')
    .select('vapi_phone_number_id')
    .eq('id', orgId)
    .single()

  return { ok: true, steps, done: Boolean(org?.vapi_phone_number_id) }
}
