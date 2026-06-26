/**
 * Phase 4 W8 — team_invitations CRUD (list pending + create).
 *
 * GET  /api/org/team/invitations           — list pending invitations
 *                                            scoped to the caller's org
 * POST /api/org/team/invitations           — create a pending invitation
 *                                            and dispatch the email
 *
 * Owner-only because invitation creation has both Resend cost and
 * permission implications. Admins can manage existing teammates but
 * not add new ones — the synthesis settled on this tier split.
 *
 * Throttle: 3 invitation sends per email per hour (mirrors
 * password_reset_throttle). Prevents email enumeration and Resend
 * cost spikes.
 *
 * Idempotency: the partial unique index
 * team_invitations_pending_per_org_email_unique enforces "one
 * pending invite per (org, email)". Inserts that would duplicate
 * are rejected with 23505, which we map to a friendly 409 here.
 */

import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requireRole, isDenied, OWNER_ONLY } from '@/lib/auth/roles'
import { sendEmail } from '@/lib/resend'
import { buildInvitationEmail } from '@/lib/email/invitation-template'

const THROTTLE_LIMIT_PER_HOUR = 3
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://tarhunna.net').replace(/\/$/, '')

const createInviteSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  role:  z.enum(['admin', 'staff']),
})

// ─── GET /api/org/team/invitations ────────────────────────────
export async function GET() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await requireRole(supabase, user.id, OWNER_ONLY)
  if (isDenied(gate)) return gate.response
  const orgId = gate.orgId

  const { data, error } = await supabase
    .from('team_invitations')
    .select('id, email, role, expires_at, created_at, invited_by')
    .eq('organization_id', orgId)
    .is('accepted_at', null)
    .is('revoked_at',  null)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ invitations: data ?? [] })
}

// ─── POST /api/org/team/invitations ───────────────────────────
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await requireRole(supabase, user.id, OWNER_ONLY)
  if (isDenied(gate)) return gate.response
  const orgId = gate.orgId

  let rawBody: unknown
  try { rawBody = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const parsed = createInviteSchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }
  const { email, role } = parsed.data

  // ── Refuse inviting an existing teammate of this org. ──
  // We zod-canonicalize email to .toLowerCase() at parse time, and
  // profiles.email is stored as the user typed it at signup. Use
  // ilike with the email VALUE escaped so '_' and '%' in the input
  // can't act as SQL wildcards — `.eq` against a lowercased value
  // would only match exact-case stores, so escape + ilike is the
  // safer middle ground until we citext-ify profiles.email.
  const escapedEmail = email.replace(/[\\%_]/g, m => '\\' + m)
  const { data: existingMember } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('organization_id', orgId)
    .ilike('email', escapedEmail)
    .maybeSingle()
  if (existingMember) {
    return NextResponse.json(
      { error: 'already_member', message: 'That email is already on your team.' },
      { status: 409 },
    )
  }

  // ── Throttle: per-(org, email) cap at 3/hour. ──
  // Scoping to organization_id closes the cross-tenant DoS + activity-
  // leak (W8 review #1): org A's burning the budget for a target
  // email no longer affects org B's ability to invite the same email.
  const sinceIso = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const { count: throttleCount } = await supabaseAdmin
    .from('invitation_throttle')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .eq('email', email)
    .gte('attempted_at', sinceIso)
  if ((throttleCount ?? 0) >= THROTTLE_LIMIT_PER_HOUR) {
    // Surface the throttle as a real 429 with a uniform shape — the
    // caller is owner-authed (per the OWNER_ONLY gate above) so we
    // don't need to mask it as success. Removing the {throttled:true}
    // success-shaped response closes the timing/body channel the
    // review flagged.
    return NextResponse.json(
      {
        error: 'too_many_invitations',
        message: 'You have sent the maximum invitations to this email this hour. Try again later.',
      },
      { status: 429 },
    )
  }

  // ── Generate token + insert invitation. ──
  // 256 bits of entropy via base64url so the link is URL-safe.
  const token = randomBytes(32).toString('base64url')

  const { data: invitation, error: insertErr } = await supabaseAdmin
    .from('team_invitations')
    .insert({
      organization_id: orgId,
      email,
      role,
      token,
      invited_by: user.id,
    })
    .select('id, email, role, token, expires_at')
    .single()

  if (insertErr) {
    // Unique-violation on the (org, email) partial unique index =
    // another pending invitation exists. Map to 409 so the UI can
    // surface "already invited — revoke first to resend."
    if (insertErr.code === '23505') {
      return NextResponse.json(
        { error: 'already_invited', message: 'There is already a pending invitation for that email.' },
        { status: 409 },
      )
    }
    return NextResponse.json({ error: insertErr.message }, { status: 500 })
  }

  // Throttle row goes here, AFTER a successful invitation insert —
  // so a duplicate-pending 23505 above doesn't burn throttle budget
  // on a never-dispatched send. Scoped to (org, email) per the W8
  // follow-up migration.
  await supabaseAdmin.from('invitation_throttle').insert({
    organization_id: orgId,
    email,
  })

  // ── Resolve org name + inviter name for the email body. ──
  const [{ data: org }, { data: inviterProfile }] = await Promise.all([
    supabaseAdmin
      .from('organizations')
      .select('name')
      .eq('id', orgId)
      .single(),
    supabaseAdmin
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .single(),
  ])

  const acceptUrl = `${APP_URL}/accept-invite?token=${invitation.token}`
  const { subject, html } = buildInvitationEmail({
    orgName: org?.name ?? 'your clinic',
    inviterFullName: inviterProfile?.full_name ?? null,
    role,
    acceptUrl,
    expiresAt: new Date(invitation.expires_at),
  })

  // ── Send. Idempotency key includes the invitation id so a retry
  // dedupes; a resend within Resend's 24h window with a different
  // body would otherwise leave the user confused about which link
  // is current. ──
  try {
    if (process.env.RESEND_API_KEY) {
      await sendEmail({
        to: email,
        subject,
        html,
        idempotencyKey: `invite:${invitation.id}`,
      })
    }
  } catch {
    // Email send failure doesn't roll back the invitation — the row
    // is the source of truth, the email is the delivery vehicle.
    // The UI surfaces "invitation pending" either way; a manual
    // resend can re-send the email.
    console.error('[team-invitation] resend send failed')
  }

  return NextResponse.json({
    id:    invitation.id,
    email: invitation.email,
    role:  invitation.role,
  }, { status: 201 })
}
