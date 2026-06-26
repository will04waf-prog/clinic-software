/**
 * Phase 4 W8 — revoke (cancel) a pending team invitation.
 *
 * DELETE /api/org/team/invitations/[id]
 *
 * Soft-revoke: sets revoked_at = now() rather than deleting the row,
 * so a future audit can see who was invited and when. The partial
 * unique index on (org, email) is filtered to revoked_at IS NULL,
 * so revoking frees the (org, email) slot for a fresh invite
 * immediately.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requireRole, isDenied, OWNER_ONLY } from '@/lib/auth/roles'

export async function DELETE(
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

  const { data, error } = await supabaseAdmin
    .from('team_invitations')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .eq('organization_id', orgId)
    .is('accepted_at', null)
    .is('revoked_at',  null)
    .select('id')
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) {
    // Either wrong org (RLS via the .eq above acts as a backstop),
    // already accepted, or already revoked. Same response shape for
    // all three so an attacker can't infer state.
    return NextResponse.json({ error: 'not_pending', message: 'Invitation is no longer pending.' }, { status: 410 })
  }
  return NextResponse.json({ ok: true })
}
