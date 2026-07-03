/**
 * Number search + provisioning core, shared by:
 *   - /api/admin/numbers/search + /provision   (HTTP boundary)
 *   - onboarding phone-number server actions    (direct calls)
 *
 * History: the onboarding server actions used to call the API routes
 * over HTTPS with hand-forwarded cookies (buildInternalHeaders). That
 * round-trip authenticated fine in the action, then 401'd at the
 * route whenever anything on the hop dropped the Cookie header —
 * e.g. NEXT_PUBLIC_APP_URL pointing at the www host, whose 307 to
 * the apex makes fetch strip cookies (cross-origin redirect rule).
 * Owners hit a raw {"error":"Unauthorized"} on the number-picker.
 * Both surfaces now call these functions in-process; the routes are
 * thin HTTP wrappers. AUTH IS THE CALLER'S JOB — every entry point
 * must run requireRole(OWNER_ONLY) and pass the resulting orgId.
 */

import { supabaseAdmin } from '@/lib/supabase/admin'
import { blockedReason } from '@/lib/billing/org-access'
import { ensureInboundAssistant, ensureReminderAssistant } from '@/lib/voice-agent/seed-assistants'
import { isTwilioConfigured } from '@/lib/twilio'
import { searchAvailableLocal, TwilioApiError, type AvailablePhoneNumber } from '@/lib/telephony/twilio-numbers'
import { makeRateLimiter } from '@/lib/public-rate-limit'

export interface NumberSearchInput {
  areaCode: string
  country:  'US' | 'CA'
  contains?: string
}

export type SearchOutcome =
  | { ok: true;  results: AvailablePhoneNumber[] }
  | { ok: false; status: number; error: string; message?: string; retryAfterSeconds?: number }

export type ProvisionOutcome =
  | { ok: true;  jobId: string }
  | { ok: false; status: number; error: string; message?: string }

// ── Per-org search rate limit ────────────────────────────────────
// Org-scoped (not IP-scoped) because Vercel invocations have
// transient IPs; 10/min deters number-harvesting while leaving
// headroom for a human picker. Shared Bucket implementation lives in
// public-rate-limit.ts (this module pioneered the shape).
export const consumeSearchSlot = makeRateLimiter(10, 60 * 1000)

/**
 * Search available local Twilio numbers for an org. Caller must have
 * already authorized the user as owner of orgId.
 */
export async function searchNumbersForOrg(orgId: string, input: NumberSearchInput): Promise<SearchOutcome> {
  const rl = consumeSearchSlot(orgId)
  if (!rl.ok) {
    return {
      ok: false, status: 429, error: 'rate_limited',
      message: `Too many searches. Try again in ${rl.retryAfterSeconds}s.`,
      retryAfterSeconds: rl.retryAfterSeconds,
    }
  }

  if (!isTwilioConfigured()) {
    return {
      ok: false, status: 503, error: 'twilio_not_configured',
      message: 'Phone-number provisioning is not enabled on this deployment.',
    }
  }

  try {
    const results = await searchAvailableLocal({
      countryCode: input.country,
      areaCode:    input.areaCode,
      contains:    input.contains,
      limit:       20,
    })
    return { ok: true, results }
  } catch (err) {
    if (err instanceof TwilioApiError) {
      // 21452 = no numbers in this area code — a normal onboarding
      // outcome, surfaced as an empty list so the UI shows its
      // "try another area code" empty state.
      if (err.code === 21452) return { ok: true, results: [] }
      console.error('[number-provisioning] Twilio search error', { status: err.status, code: err.code })
      return { ok: false, status: 502, error: 'twilio_error', message: err.message }
    }
    console.error('[number-provisioning] unexpected search error', err)
    return { ok: false, status: 500, error: 'internal_error' }
  }
}

/**
 * Validate preconditions, auto-seed the Vapi assistants, and enqueue
 * the buy_twilio_number job for an org. Caller must have already
 * authorized the user as owner of orgId.
 */
export async function provisionNumberForOrg(
  orgId: string,
  e164: string,
  requestedByUserId: string,
): Promise<ProvisionOutcome> {
  // Service-role read is safe: the caller already authorized this
  // user as owner of THIS org.
  const { data: org, error: orgErr } = await supabaseAdmin
    .from('organizations')
    .select('id, name, call_agent_assistant_id, call_agent_reminder_assistant_id, vapi_phone_number_id, twilio_phone_sid, plan_status, trial_ends_at')
    .eq('id', orgId)
    .single()

  if (orgErr || !org) {
    console.error('[number-provisioning] org lookup failed', { orgId, err: orgErr?.message })
    return { ok: false, status: 500, error: 'internal_error' }
  }

  // Plan lockout: buying a number commits the platform to recurring
  // Twilio rent. The proxy exempts /onboarding so blocked owners can
  // still navigate — this path must gate itself.
  const lock = blockedReason(org.plan_status, org.trial_ends_at)
  if (lock) {
    return {
      ok: false, status: 403, error: 'plan_locked',
      message: `Your plan is ${lock.replace('_', ' ')} — subscribe to provision a phone number.`,
    }
  }

  // Self-serve seeding. The inbound assistant is REQUIRED — the
  // register_vapi_phone pipeline step binds the number to it.
  if (!org.call_agent_assistant_id) {
    try {
      const seeded = await ensureInboundAssistant({ supabase: supabaseAdmin, orgId })
      console.log(`[number-provisioning] seeded inbound assistant ${seeded.assistantId} for org ${orgId}`)
    } catch (err) {
      console.error('[number-provisioning] assistant seeding failed', { orgId, err: err instanceof Error ? err.message : err })
      return {
        ok: false, status: 502, error: 'assistant_seed_failed',
        message: 'Could not set up the voice assistant. Please try again in a minute — if it keeps failing, contact support.',
      }
    }
  }
  // Deliberately OUTSIDE the inbound-null guard: orgs whose inbound
  // assistant was operator-seeded (all pre-self-serve orgs) would
  // otherwise never get a reminder assistant, and a transient failure
  // here gets another chance on any later provision attempt.
  if (!org.call_agent_reminder_assistant_id) {
    try {
      await ensureReminderAssistant({ supabase: supabaseAdmin, orgId })
    } catch (err) {
      console.warn('[number-provisioning] reminder-assistant seeding failed (non-fatal)', { orgId, err: err instanceof Error ? err.message : err })
    }
  }

  if (org.vapi_phone_number_id) {
    return {
      ok: false, status: 409, error: 'number_already_provisioned',
      message: 'This clinic already has a phone number on file. Release the existing one before buying a new one.',
    }
  }

  // Enqueue buy_twilio_number — first step of the M5 pipeline. The
  // (org, step) partial-unique index (failed rows excluded) turns a
  // concurrent double-click into a 23505 we map to a clean conflict.
  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from('provisioning_jobs')
    .insert({
      organization_id: orgId,
      step:            'buy_twilio_number',
      status:          'pending',
      payload: {
        e164,
        // Audit, PHI-light: just the user id; dashboards can join.
        requested_by_user_id: requestedByUserId,
      },
    })
    .select('id')
    .single()

  if (insertErr) {
    if ((insertErr as { code?: string }).code === '23505') {
      return {
        ok: false, status: 409, error: 'provisioning_already_pending',
        message: 'A number purchase is already pending for this clinic. Check the admin dashboard for progress.',
      }
    }
    console.error('[number-provisioning] insert failed', { orgId, err: insertErr.message })
    return { ok: false, status: 500, error: 'internal_error' }
  }

  return { ok: true, jobId: inserted.id }
}
