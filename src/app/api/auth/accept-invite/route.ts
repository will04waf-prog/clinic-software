/**
 * Phase 4 W8 — accept a team_invitation and create the joining user.
 *
 * POST /api/auth/accept-invite
 * Body: { token, full_name, password }
 *
 * Flow:
 *   1. Resolve the invitation by token. Must be pending (not
 *      accepted, not revoked, not expired).
 *   2. createUser(email_confirm=true) for the invitee. If the email
 *      is already an auth.users (another org / a prior soft-deleted
 *      account), surface a friendly conflict.
 *   3. Insert the profile with organization_id + role from the
 *      invitation row (NOT from client input — single source of
 *      trust).
 *   4. Stamp accepted_at on the invitation.
 *
 * Critically, this route does NOT call auth.admin.deleteUser on
 * downstream failure (the signup route does, but here the user may
 * already exist for legitimate reasons; a stale orphan auth row is
 * a smaller problem than nuking a real user's account).
 *
 * The accept page client then signs in via supabase.auth
 * signInWithPassword and pushes to /dashboard.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { z } from 'zod'

const acceptSchema = z.object({
  token:     z.string().min(8).max(200),
  full_name: z.string().trim().min(1).max(120),
  password:  z.string().min(8).max(200),
})

export async function POST(req: NextRequest) {
  // ── Env guard. ──
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    return NextResponse.json({ error: 'Server not configured' }, { status: 503 })
  }

  let rawBody: unknown
  try { rawBody = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const parsed = acceptSchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }
  const { token, full_name, password } = parsed.data

  // ── 1. Stake the claim FIRST via atomic CAS. ──
  // We mark the invitation accepted BEFORE creating the auth user
  // so a concurrent accept / revoke that arrives during our
  // createUser round-trip can't end up creating two profiles or
  // accepting a revoked invitation. If the UPDATE matches zero
  // rows, the invitation is no longer in a claimable state and we
  // bail BEFORE touching auth.users.
  const nowIso = new Date().toISOString()
  const { data: claimed, error: claimErr } = await supabaseAdmin
    .from('team_invitations')
    .update({ accepted_at: nowIso })
    .eq('token', token)
    .is('accepted_at', null)
    .is('revoked_at',  null)
    .gt('expires_at',  nowIso)
    .select('id, organization_id, email, role')
    .maybeSingle()
  if (claimErr) return NextResponse.json({ error: 'claim_failed' }, { status: 500 })
  if (!claimed) {
    // Could be any of: token doesn't exist, already accepted,
    // revoked, or expired. Collapse all four to one message so an
    // attacker probing tokens can't distinguish.
    return NextResponse.json(
      { error: 'invalid_or_used', message: 'This invitation link is no longer valid.' },
      { status: 410 },
    )
  }

  // From here on we own this invitation row. Any failure path
  // below either (a) leaves accepted_at set with no usable side
  // effects (harmless dead row — the owner can re-invite) or
  // (b) rolls back the auth.users row we just created.

  // ── 2. Create the auth user. ──
  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email:    claimed.email,
    password,
    email_confirm: true,
    user_metadata: { full_name },
  })

  if (authError || !authData.user) {
    if (authError?.message?.toLowerCase().includes('already')) {
      return NextResponse.json(
        { error: 'email_taken', message: 'An account already exists for this email. Sign in instead.' },
        { status: 409 },
      )
    }
    return NextResponse.json({ error: authError?.message ?? 'auth_create_failed' }, { status: 500 })
  }
  const userId = authData.user.id

  // ── 3. Insert the profile. ──
  // organization_id + role come from the claimed row, NOT client
  // input — the only user-mutable identity field is full_name.
  const { error: profileError } = await supabaseAdmin.from('profiles').insert({
    id:              userId,
    organization_id: claimed.organization_id,
    full_name,
    email:           claimed.email,
    role:            claimed.role,
    is_active:       true,
  })

  if (profileError) {
    // We OWN this auth.users row — we created it 30ms ago. Hard
    // delete is safe here (unlike the more general 'don't deleteUser'
    // rule, which guards against nuking a real returning user). Roll
    // back so a retry can succeed cleanly.
    console.error('[accept-invite] profile insert failed:', profileError.message)
    await supabaseAdmin.auth.admin.deleteUser(userId).catch(() => {
      console.error('[accept-invite] rollback deleteUser failed for', userId)
    })
    return NextResponse.json(
      { error: 'profile_create_failed', message: 'Account setup failed. Please try the invitation link again.' },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true, email: claimed.email })
}
