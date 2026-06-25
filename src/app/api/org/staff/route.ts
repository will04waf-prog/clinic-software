import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/org/staff — list profiles belonging to the caller's org.
 * Used by the booking Providers card to offer "Linked staff user
 * (optional)" so a provider can map to an existing dashboard user.
 *
 * Returns a minimal shape — id + full_name + email — and explicitly
 * scopes by organization_id so an attacker can't enumerate other
 * orgs' users.
 */
export async function GET(_req: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single()
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  const { data: staff, error } = await supabase
    .from('profiles')
    .select('id, full_name, email')
    .eq('organization_id', profile.organization_id)
    .order('full_name', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ staff: staff ?? [] })
}
