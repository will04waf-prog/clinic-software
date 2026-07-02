/**
 * Phase 5 M2 — POST /api/admin/numbers/search
 *
 * Owner-facing search for available local Twilio numbers. Used by
 * the super-admin dashboard (M6) when the operator is manually
 * provisioning a replacement number for an org. The onboarding
 * number-picker (M3) calls the shared service directly from its
 * server action — it does NOT round-trip through this route.
 *
 * Auth: owner role required (requireRole OWNER_ONLY). This is
 * deliberately a per-ORG endpoint, not a super-admin endpoint. The
 * rate limit, env gate, and Twilio call live in
 * src/lib/telephony/number-provisioning-service.ts (shared with the
 * onboarding action); this file is only the HTTP boundary.
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
 *   502 twilio error
 *   503 twilio not configured
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { requireRole, OWNER_ONLY, isDenied } from '@/lib/auth/roles'
import { searchNumbersForOrg } from '@/lib/telephony/number-provisioning-service'

const bodySchema = z.object({
  // 3-digit US area code OR ISO-localized equivalent. Twilio's
  // AreaCode parameter accepts 2-4 digit prefixes for international
  // Locals — the API will 400 cleanly if it's malformed.
  areaCode: z.string().min(2).max(8).regex(/^[0-9]+$/, { message: 'area_code_digits_only' }),
  country:  z.enum(['US', 'CA']).default('US'),
  contains: z.string().max(16).optional(),
}).strict()

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const gate = await requireRole(supabase, user.id, OWNER_ONLY)
  if (isDenied(gate)) return gate.response
  const { orgId } = gate

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

  const outcome = await searchNumbersForOrg(orgId, parsed.data)
  if (!outcome.ok) {
    const headers = outcome.retryAfterSeconds
      ? { 'Retry-After': String(outcome.retryAfterSeconds) }
      : undefined
    return NextResponse.json(
      { error: outcome.error, ...(outcome.message ? { message: outcome.message } : {}) },
      { status: outcome.status, headers },
    )
  }
  return NextResponse.json({ results: outcome.results })
}
