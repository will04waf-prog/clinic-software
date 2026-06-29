/**
 * Phase 5 M2 — POST /api/admin/numbers/search
 *
 * Owner-facing search for available local Twilio numbers. Used by
 * the onboarding number-picker (M3) and by the super-admin
 * dashboard (M6) when the operator is manually provisioning a
 * replacement number for an org.
 *
 * Auth: owner role required (requireRole OWNER_ONLY). This is
 * deliberately a per-ORG endpoint, not a super-admin endpoint —
 * owners need to search numbers themselves during onboarding. The
 * gate is the orgId returned by requireRole, which we also use as
 * the rate-limit bucket key (one bucket per clinic, NOT per IP)
 * because the onboarding form may be opened from multiple devices
 * by the same owner but a runaway script abusing the search
 * endpoint will still hit the same per-org cap.
 *
 * Why a per-org in-memory rate limit and not per-IP:
 *   - Vercel serverless invocations have transient public IPs;
 *     the in-memory limiter would not effectively gate a stable
 *     attacker against a single org.
 *   - The org-level cap (10/min) is tight enough to deter the
 *     "burn through search results to harvest numbers" pattern
 *     while leaving plenty of headroom for a human picker.
 *   - Process-wide map is fine for a single-instance dev/staging;
 *     when we move to multi-instance, swap for KV. Same Bucket
 *     shape as public-rate-limit.ts so the swap is mechanical.
 *
 * Request body (validated with zod):
 *   { areaCode: string, country?: 'US' | 'CA', contains?: string }
 *
 * Response:
 *   200 { results: [{ e164, friendlyName, region, locality, capabilities }] }
 *   400 invalid input
 *   401 unauthenticated
 *   403 not an owner
 *   429 rate limited
 *   502 twilio error (with code if surfaced)
 *   503 twilio not configured
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { requireRole, OWNER_ONLY, isDenied } from '@/lib/auth/roles'
import { isTwilioConfigured } from '@/lib/twilio'
import { searchAvailableLocal, TwilioApiError } from '@/lib/telephony/twilio-numbers'

// ── Per-org rate-limit bucket. See module docstring for why this
// is org-scoped instead of IP-scoped. ───────────────────────────
interface Bucket {
  count:   number
  resetAt: number
}
const SEARCH_BUCKETS = new Map<string, Bucket>()
const SEARCH_LIMIT     = 10            // 10 searches per minute per org
const SEARCH_WINDOW_MS = 60 * 1000

function consumeSearchSlot(orgId: string, now: number = Date.now()): { ok: boolean; retryAfterSeconds: number } {
  const existing = SEARCH_BUCKETS.get(orgId)
  if (!existing || existing.resetAt <= now) {
    SEARCH_BUCKETS.set(orgId, { count: 1, resetAt: now + SEARCH_WINDOW_MS })
    return { ok: true, retryAfterSeconds: 0 }
  }
  if (existing.count >= SEARCH_LIMIT) {
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)) }
  }
  existing.count += 1
  return { ok: true, retryAfterSeconds: 0 }
}

// ── Input schema. We only allow the columns the UI surfaces; the
// underlying Twilio API supports more (nearLatLong, inPostalCode,
// distance, etc.) but exposing them all is search-engine surface
// area we don't need yet. ───────────────────────────────────────
const bodySchema = z.object({
  // 3-digit US area code OR ISO-localized equivalent. We do NOT
  // validate the exact format here because Twilio's AreaCode
  // parameter accepts 2-4 digit prefixes for international Locals
  // — the API will 400 cleanly if it's malformed.
  areaCode: z.string().min(2).max(8).regex(/^[0-9]+$/, { message: 'area_code_digits_only' }),
  country:  z.enum(['US', 'CA']).default('US'),
  contains: z.string().max(16).optional(),
}).strict()

export async function POST(req: NextRequest) {
  // ── 1. Auth ────────────────────────────────────────────────
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const gate = await requireRole(supabase, user.id, OWNER_ONLY)
  if (isDenied(gate)) return gate.response
  const { orgId } = gate

  // ── 2. Rate limit (per org, see module docstring) ──────────
  const rl = consumeSearchSlot(orgId)
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'rate_limited', message: `Too many searches. Try again in ${rl.retryAfterSeconds}s.` },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    )
  }

  // ── 3. Env gate ────────────────────────────────────────────
  // We surface 503 (rather than 500) so the onboarding UI can
  // distinguish "Twilio isn't configured on the platform" from
  // "Twilio refused this search". The former is an operator
  // problem; the latter the user can recover from by changing
  // the area code.
  if (!isTwilioConfigured()) {
    return NextResponse.json(
      { error: 'twilio_not_configured', message: 'Phone-number provisioning is not enabled on this deployment.' },
      { status: 503 },
    )
  }

  // ── 4. Body ────────────────────────────────────────────────
  let raw: unknown
  try { raw = await req.json() } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_input', message: parsed.error.issues[0]?.message ?? 'invalid_input' },
      { status: 400 },
    )
  }
  const { areaCode, country, contains } = parsed.data

  // ── 5. Twilio call ─────────────────────────────────────────
  // limit=20 is the M2 contract per the task brief. Twilio's
  // PageSize caps at 50 anyway. The wrapper already filters to
  // voice+sms capable numbers so the UI never offers a number
  // we'd be unable to provision through Vapi (voice-only would
  // fail at binding) or send confirmations from (sms-required).
  let results
  try {
    results = await searchAvailableLocal({ countryCode: country, areaCode, contains, limit: 20 })
  } catch (err) {
    if (err instanceof TwilioApiError) {
      // 21452 = no phone numbers found in this area code — frequent
      // enough during onboarding that we surface it as 200 with an
      // empty list rather than an error, so the UI can show the
      // "no numbers — try another area code" empty state directly.
      if (err.code === 21452) {
        return NextResponse.json({ results: [] })
      }
      console.error('[admin/numbers/search] Twilio error', { status: err.status, code: err.code })
      return NextResponse.json(
        { error: 'twilio_error', code: err.code, message: err.message },
        { status: 502 },
      )
    }
    console.error('[admin/numbers/search] unexpected error', err)
    return NextResponse.json({ error: 'internal_error' }, { status: 500 })
  }

  return NextResponse.json({ results })
}
