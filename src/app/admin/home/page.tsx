import { supabaseAdmin } from '@/lib/supabase/admin'
import { formatRelative } from '@/lib/utils'

const PLAN_STATUS_COLORS: Record<string, string> = {
  active:    'bg-emerald-100 text-emerald-700',
  past_due:  'bg-yellow-100 text-yellow-700',
  canceled:  'bg-red-100 text-red-700',
}

const PLAN_COLORS: Record<string, string> = {
  trial:   'bg-gray-100 text-gray-600',
  starter: 'bg-blue-100 text-blue-700',
  pro:     'bg-indigo-100 text-indigo-700',
}

export default async function AdminHomePage() {
  const [
    { count: totalOrgs },
    { count: totalUsers },
    { count: trialCount },
    { count: starterCount },
    { count: proCount },
    { count: activeCount },
    { count: pastDueCount },
    { count: canceledCount },
    { data: recentOrgs },
  ] = await Promise.all([
    supabaseAdmin.from('organizations').select('*', { count: 'exact', head: true }),
    supabaseAdmin.from('profiles').select('*', { count: 'exact', head: true }),
    supabaseAdmin.from('organizations').select('*', { count: 'exact', head: true }).eq('plan', 'trial'),
    supabaseAdmin.from('organizations').select('*', { count: 'exact', head: true }).eq('plan', 'starter'),
    supabaseAdmin.from('organizations').select('*', { count: 'exact', head: true }).eq('plan', 'pro'),
    supabaseAdmin.from('organizations').select('*', { count: 'exact', head: true }).eq('plan_status', 'active'),
    supabaseAdmin.from('organizations').select('*', { count: 'exact', head: true }).eq('plan_status', 'past_due'),
    supabaseAdmin.from('organizations').select('*', { count: 'exact', head: true }).eq('plan_status', 'canceled'),
    supabaseAdmin.from('organizations').select('id, name, plan, plan_status, created_at').order('created_at', { ascending: false }).limit(5),
  ])

  const stats = [
    { label: 'Total Accounts',  value: totalOrgs  ?? 0 },
    { label: 'Total Users',     value: totalUsers ?? 0 },
    { label: 'Active',          value: activeCount   ?? 0, color: 'text-emerald-600' },
    { label: 'Trial',           value: trialCount    ?? 0, color: 'text-gray-600'    },
    { label: 'Starter',         value: starterCount  ?? 0, color: 'text-blue-600'    },
    { label: 'Pro',             value: proCount      ?? 0, color: 'text-indigo-600'  },
    { label: 'Past Due',        value: pastDueCount  ?? 0, color: 'text-yellow-600'  },
    { label: 'Canceled',        value: canceledCount ?? 0, color: 'text-red-600'     },
  ]

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Admin Home</h1>
        <p className="text-sm text-gray-500 mt-0.5">Platform overview</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 mb-8">
        {stats.map(({ label, value, color }) => (
          <div key={label} className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-xs text-gray-500">{label}</p>
            <p className={`text-2xl font-bold mt-1 ${color ?? 'text-gray-900'}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Recent signups */}
      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">Recent Signups</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Account</th>
              <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Plan</th>
              <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
              <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Signed Up</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {(recentOrgs ?? []).length === 0 && (
              <tr>
                <td colSpan={4} className="px-5 py-8 text-center text-sm text-gray-400">No accounts yet</td>
              </tr>
            )}
            {(recentOrgs ?? []).map((org) => (
              <tr key={org.id} className="hover:bg-gray-50">
                <td className="px-5 py-3 font-medium text-gray-900">{org.name}</td>
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
                <td className="px-5 py-3 text-gray-400">{formatRelative(org.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
