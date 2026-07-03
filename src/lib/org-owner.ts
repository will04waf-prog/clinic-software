/**
 * Org owner lookup — THE way to resolve "who do we email about this
 * org". Previously re-implemented in trial-reminders, weekly-digest,
 * and lead-notifications with drifting semantics: the maybeSingle()
 * variant returns data:null when an org has promoted a SECOND owner
 * (PGRST116 multi-row), silently dropping every owner email for that
 * org forever. This helper always takes the oldest owner row.
 */

import { supabaseAdmin } from '@/lib/supabase/admin'

export interface OrgOwner {
  email: string
  full_name: string | null
}

export async function getOrgOwner(orgId: string): Promise<OrgOwner | null> {
  const { data } = await supabaseAdmin
    .from('profiles')
    .select('email, full_name')
    .eq('organization_id', orgId)
    .eq('role', 'owner')
    .order('created_at', { ascending: true })
    .limit(1)
  const owner = data?.[0]
  return owner?.email ? { email: owner.email, full_name: owner.full_name ?? null } : null
}
