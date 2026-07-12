/**
 * E2E cleanup: remove a throwaway test org and every row it owns, in
 * FK-safe order (payments restrict invoice deletes; invoices restrict
 * contact deletes), then the auth user. Prints what it removed.
 * Throwaway diagnostic — service-role, targeted by org id arg.
 */
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
const orgId = process.argv[2]
if (!url || !key || !orgId) throw new Error('need env + org id arg')

const db = createClient(url, key)

async function wipe(table: string): Promise<number> {
  const { data, error } = await db.from(table).delete().eq('organization_id', orgId).select('id')
  if (error) throw new Error(`${table}: ${error.message}`)
  return data?.length ?? 0
}

async function main() {
  const { data: org } = await db
    .from('organizations')
    .select('name, vertical, stripe_connect_id')
    .eq('id', orgId)
    .single()
  if (!org) throw new Error('org not found — refusing to guess')
  if (!org.name?.startsWith('E2E ')) throw new Error(`org "${org.name}" is not an E2E org — aborting`)

  const { data: profiles } = await db.from('profiles').select('id, email').eq('organization_id', orgId)

  const counts: Record<string, number> = {}
  for (const t of ['payments', 'invoice_line_items', 'invoices', 'jobs', 'estimate_line_items', 'estimates',
                   'appointments', 'consultations', 'messages', 'leads', 'contacts', 'pipeline_stages']) {
    try { counts[t] = await wipe(t) } catch (e: any) { counts[t] = -1; console.error(`  (${t}: ${e.message})`) }
  }

  const { error: profErr } = await db.from('profiles').delete().eq('organization_id', orgId)
  if (profErr) console.error('profiles:', profErr.message)
  const { error: orgErr } = await db.from('organizations').delete().eq('id', orgId)
  if (orgErr) throw new Error('org delete failed: ' + orgErr.message)

  for (const p of profiles ?? []) {
    const { error } = await db.auth.admin.deleteUser(p.id)
    console.log(`auth user ${p.email}: ${error ? 'ERR ' + error.message : 'deleted'}`)
  }

  console.log(JSON.stringify({ org: org.name, connect: org.stripe_connect_id, deleted: counts }))
}

main()
