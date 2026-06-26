/**
 * Phase 4 W9 — re-send a pending team invitation.
 *
 * POST /api/org/team/invitations/[id]/resend
 *
 * Owner-only. Same email body + token + accept-invite link as the
 * original; we increment resend_count + extend expires_at +7d. The
 * idempotency key includes resend_count so Resend's 24h server-side
 * dedupe doesn't silently swallow the re-send.
 *
 * Throttle: shares the same per-(org, email) invitation_throttle as
 * the POST handler. Without this an owner could effectively get 6/hr
 * per (org, email) — undoes the W8 security review fix.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requireRole, isDenied, OWNER_ONLY } from '@/lib/auth/roles'
import { sendEmail } from '@/lib/resend'
import { buildInvitationEmail } from '@/lib/email/invitation-template'

const THROTTLE_LIMIT_PER_HOUR = 3
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://tarhunna.net').replace(/\/$/, '')

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await requireRole(supabase, user.id, OWNER_ONLY)
  if (isDenied(gate)) return gate.response
  const orgId = gate.orgId

  // Fetch the invitation. Must be pending (not accepted, not revoked,
  // not expired) — a revoked or expired invitation should be revived
  // by deleting + re-inviting, not by resend.
  const { data: invitation, error: fetchErr } = await supabase
    .from('team_invitations')
    .select('id, email, role, token, resend_count, accepted_at, revoked_at, expires_at')
    .eq('id', id)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 })
  if (!invitation) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  if (invitation.accepted_at) {
    return NextResponse.json(
      { error: 'already_accepted', message: 'This invitation has already been accepted.' },
      { status: 410 },
    )
  }
  if (invitation.revoked_at) {
    return NextResponse.json(
      { error: 'revoked', message: 'This invitation was revoked. Send a new one instead.' },
      { status: 410 },
    )
  }
  // Refuse to resurrect an already-expired invitation. Resend would
  // extend expires_at +7d which effectively un-expires a dead row
  // (the W9 cleanup cron flips revoked_at AFTER expires_at passes,
  // but there's a window before the cron runs where an expired-but-
  // not-yet-revoked row sits in the DB). Force the owner to revoke +
  // re-invite instead.
  if (new Date(invitation.expires_at).getTime() <= Date.now()) {
    return NextResponse.json(
      { error: 'expired', message: 'This invitation expired. Revoke it and send a fresh invitation.' },
      { status: 410 },
    )
  }

  // Throttle — shares the per-(org, email) budget with the original
  // POST so a resend can't loophole the 3/hr cap.
  const sinceIso = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const { count: throttleCount } = await supabaseAdmin
    .from('invitation_throttle')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .eq('email', invitation.email)
    .gte('attempted_at', sinceIso)
  if ((throttleCount ?? 0) >= THROTTLE_LIMIT_PER_HOUR) {
    return NextResponse.json(
      {
        error: 'too_many_invitations',
        message: 'You have re-sent the maximum invitations to this email this hour. Try again later.',
      },
      { status: 429 },
    )
  }

  // Extend expires_at +7d and bump resend_count atomically. The
  // returned row gives us the updated resend_count to use in the
  // Resend idempotency key.
  const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  const newResendCount = (invitation.resend_count ?? 0) + 1
  const { data: updated, error: updErr } = await supabaseAdmin
    .from('team_invitations')
    .update({
      resend_count:   newResendCount,
      last_resent_at: new Date().toISOString(),
      expires_at:     newExpiresAt,
    })
    .eq('id', invitation.id)
    .is('accepted_at', null)
    .is('revoked_at',  null)
    .select('id')
    .maybeSingle()
  if (updErr || !updated) {
    return NextResponse.json({ error: 'resend_failed' }, { status: 500 })
  }

  // Burn throttle on actual dispatched send.
  await supabaseAdmin.from('invitation_throttle').insert({
    organization_id: orgId,
    email: invitation.email,
  })

  // Lookup org name + inviter name for the email body. The original
  // inviter may have changed roles since invitation creation, but we
  // continue showing the original inviting account for consistency
  // with the patient-facing copy.
  const [{ data: org }, { data: inviterProfile }] = await Promise.all([
    supabaseAdmin.from('organizations').select('name').eq('id', orgId).single(),
    supabaseAdmin.from('profiles').select('full_name').eq('id', user.id).single(),
  ])

  const acceptUrl = `${APP_URL}/accept-invite?token=${invitation.token}`
  const { subject, html } = buildInvitationEmail({
    orgName: org?.name ?? 'your clinic',
    inviterFullName: inviterProfile?.full_name ?? null,
    role: invitation.role as 'admin' | 'staff',
    acceptUrl,
    expiresAt: new Date(newExpiresAt),
  })

  let emailSent = process.env.RESEND_API_KEY ? false : true
  try {
    if (process.env.RESEND_API_KEY) {
      await sendEmail({
        to: invitation.email,
        subject,
        html,
        // Include resend_count so Resend's 24h server-side dedupe
        // doesn't silently swallow the re-send.
        idempotencyKey: `invite:${invitation.id}:resend:${newResendCount}`,
      })
      emailSent = true
    }
  } catch {
    console.error('[invitation-resend] resend send failed')
  }

  // Surface dispatch failure as 502 so the UI can prompt a retry
  // instead of showing success while the email is silently dropped.
  // The invitation row stays updated (resend_count bumped, expiry
  // extended) — owner can retry resend without burning extra
  // throttle since the throttle row is already in place.
  if (!emailSent) {
    return NextResponse.json(
      {
        error: 'email_dispatch_failed',
        message: 'Could not send the email. Try again in a moment.',
        resend_count: newResendCount,
      },
      { status: 502 },
    )
  }

  return NextResponse.json({ ok: true, resend_count: newResendCount })
}
