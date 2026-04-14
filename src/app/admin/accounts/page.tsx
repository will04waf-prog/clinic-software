import Link from 'next/link'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { formatRelative } from '@/lib/utils'

const PLAN_STATUS_COLORS: Record<string, string> = {
  active:   'bg-emerald-100 text-emerald-700',
  past_due: 'bg-yellow-100 text-yellow-700',
  canceled: 'bg-red-100 text-red-700',
}

const PLAN_COLORS: Record<string, string> = {
  trial:   'bg-gray-100 text-gray-600',
  starter: 'bg-blue-100 text-blue-700',
  pro:     'bg-indigo-100 text-indigo-700',
}

export default async function AdminAccountsPage() {
  const { data: orgs } = await supabaseAdmin
    .from('organizations')
    .select('id, name, email, phone, plan, plan_status, created_at')
    .order('created_at', { ascending: false })

  // For each org, get user count and contact count
  const enriched = await Promise.all(
    (orgs ?? []).map(async (org) => {
      const [{ count: userCount }, { count: contactCount }] = await Promise.all([
        supabaseAdmin.from('profiles').select('*', { count: 'exact', head: true }).eq('organization_id', org.id),
        supabaseAdmin.from('contacts').select('*', { count: 'exact', head: true }).eq('organization_id', org.id).eq('is_archived', false),
      ])

      // Owner profile
      const { data: owner } = await supabaseAdmin
        .from('profiles')
        .select('full_name, email')
        .eq('organization_id', org.id)
        .eq('role', 'owner')
        .maybeSingle()

      return { ...org, userCount: userCount ?? 0, contactCount: contactCount ?? 0, owner }
    })
  )

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Accounts</h1>
        <p className="text-sm text-gray-500 mt-0.5">{enriched.length} total organizations</p>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Account</th>
              <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Owner</th>
              <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Plan</th>
              <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
              <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Users</th>
              <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Contacts</th>
              <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Created</th>
              <th className="w-10 px-5 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {enriched.length === 0 && (
              <tr>
                <td colSpan={8} className="px-5 py-8 text-center text-sm text-gray-400">No accounts found</td>
              </tr>
            )}
            {enriched.map((org) => (
              <tr key={org.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-5 py-3">
                  <p className="font-medium text-gray-900">{org.name}</p>
                  {org.email && <p className="text-xs text-gray-400">{org.email}</p>}
                </td>
                <td className="px-5 py-3">
                  {org.owner ? (
                    <>
                      <p className="text-gray-700">{org.owner.full_name}</p>
                      <p className="text-xs text-gray-400">{org.owner.email}</p>
                    </>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
                <td className="px-5 py-3">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${PLAN_COLORS[org.plan] ?? 'bg-gray-100 text-gray-600'}`}>
                    {org.plan}
                  </span>
                </td>
                <td className="px-5 py-3">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${PLAN_STATUS_COLORS[org.plan_status] ?? 'bg-gray-100 text-gray-600'}`}>
                    {org.plan_status}
                  </span>
                </td>
                <td className="px-5 py-3 text-gray-600">{org.userCount}</td>
                <td className="px-5 py-3 text-gray-600">{org.contactCount}</td>
                <td className="px-5 py-3 text-gray-400">{formatRelative(org.created_at)}</td>
                <td className="px-5 py-3">
                  <Link
                    href={`/admin/accounts/${org.id}`}
                    className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                  >
                    View →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
