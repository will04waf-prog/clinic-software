/**
 * Phase 5 M2 — POST /api/admin/numbers/provision
 *
 * Owner-facing endpoint that enqueues a number-buy job for the
 * caller's org. The actual Twilio purchase + Vapi registration
 * happens asynchronously in the M5 provisioning_jobs queue.
 *
 * Used by the super-admin dashboard (M6); the onboarding wizard (M3)
 * calls the shared service directly from its server action — it does
 * NOT round-trip through this route. Preconditions (plan lockout,
 * assistant auto-seeding, already-provisioned, concurrent-enqueue
 * dedup) live in src/lib/telephony/number-provisioning-service.ts;
 * this file is only the HTTP boundary.
 *
 * Body: { e164: string (E.164) }
 * Response:
 *   200 { job_id, status: 'pending' }
 *   400 invalid input
 *   401 unauthenticated
 *   403 not an owner / plan locked
 *   409 conflict (already-provisioned / queue-busy)
 *   502 assistant seeding failed
 *   500 db error
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { requireRole, OWNER_ONLY, isDenied } from '@/lib/auth/roles'
import { provisionNumberForOrg } from '@/lib/telephony/number-provisioning-service'

const bodySchema = z.object({
  // E.164 — same regex used elsewhere in the codebase for phone
  // validation (+ country code, 7-15 digits).
  e164: z.string().regex(/^\+[1-9]\d{6,14}$/, { message: 'invalid_e164' }),
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

  const outcome = await provisionNumberForOrg(orgId, parsed.data.e164, user.id)
  if (!outcome.ok) {
    return NextResponse.json(
      { error: outcome.error, ...(outcome.message ? { message: outcome.message } : {}) },
      { status: outcome.status },
    )
  }
  return NextResponse.json({ job_id: outcome.jobId, status: 'pending' as const })
}
