/**
 * Phase 4 W8 — list team members.
 *
 * GET /api/org/team
 *
 * Returns every profile in the caller's org, active and inactive,
 * so the settings page can render them with the "deactivated" badge.
 * The UI filters by default; the inactive ones are still visible via
 * the "+N inactive — show" toggle pattern we already use for
 * providers + services.
 *
 * Readable by every authenticated org member (OWNER_ADMIN_STAFF).
 * Mutations live in /[id]/route.ts and are owner-only.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireRole, isDenied, OWNER_ADMIN_STAFF } from '@/lib/auth/roles'

export async function GET() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await requireRole(supabase, user.id, OWNER_ADMIN_STAFF)
  if (isDenied(gate)) return gate.response

  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email, role, is_active, created_at')
    .eq('organization_id', gate.orgId)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ members: data ?? [] })
}
