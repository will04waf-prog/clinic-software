// ============================================================
// Organization + plan lookup helpers
// ============================================================
// Centralizes the user → org → plan resolution that several API
// routes used to inline. The enforcement layer
// (src/lib/billing/enforce-tier.ts) and any cron path that needs
// to read plan without a user session both go through getPlanByOrgId.

export interface OrgPlanInfo {
  plan:       string
  planStatus: string
}

export interface UserOrgPlanInfo extends OrgPlanInfo {
  orgId: string
}

/**
 * Resolve the organization's plan + plan_status by org id. Used by
 * enforcement helpers and any code path that already has an org id
 * (e.g. cron handlers).
 */
export async function getPlanByOrgId(
  supabase: any,
  orgId: string,
): Promise<OrgPlanInfo | null> {
  const { data, error } = await supabase
    .from('organizations')
    .select('plan, plan_status')
    .eq('id', orgId)
    .single()
  if (error || !data) return null
  return { plan: data.plan, planStatus: data.plan_status }
}

/**
 * Resolve org id, plan, and plan_status for an authenticated user.
 * Returns null if the profile or organization can't be resolved —
 * callers are expected to translate that into a 404.
 */
export async function getOrgIdAndPlan(
  supabase: any,
  userId: string,
): Promise<UserOrgPlanInfo | null> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', userId)
    .single()

  if (!profile?.organization_id) return null

  const planInfo = await getPlanByOrgId(supabase, profile.organization_id)
  if (!planInfo) return null

  return { orgId: profile.organization_id, ...planInfo }
}
