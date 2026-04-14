import { supabaseAdmin } from '@/lib/supabase/admin'
import { formatRelative } from '@/lib/utils'
import Link from 'next/link'

export default async function AdminUsersPage() {
  const { data: users } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name, email, role, is_super_admin, organization_id, created_at, organization:organizations(name)')
    .order('created_at', { ascending: false })

  // Get last sign in from auth.users
  const { data: { users: authUsers } } = await supabaseAdmin.auth.admin.listUsers()
  const lastSignInMap = Object.fromEntries(
    (authUsers ?? []).map((u) => [u.id, u.last_sign_in_at])
  )

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Users</h1>
        <p className="text-sm text-gray-500 mt-0.5">{(users ?? []).length} total users across all accounts</p>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Name</th>
              <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Email</th>
              <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Role</th>
              <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Account</th>
              <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Last Login</th>
              <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Joined</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {(users ?? []).length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-8 text-center text-sm text-gray-400">No users found</td>
              </tr>
            )}
            {(users ?? []).map((user) => {
              const org = (user.organization as any)
              const lastLogin = lastSignInMap[user.id]
              return (
                <tr key={user.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-3">
                    <p className="font-medium text-gray-900">{user.full_name}</p>
                    {user.is_super_admin && (
                      <span className="text-xs text-indigo-600 font-medium">super admin</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-gray-600">{user.email}</td>
                  <td className="px-5 py-3 text-gray-600 capitalize">{user.role}</td>
                  <td className="px-5 py-3">
                    {org ? (
                      <Link
                        href={`/admin/accounts/${user.organization_id}`}
                        className="text-indigo-600 hover:text-indigo-800"
                      >
                        {org.name}
                      </Link>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-gray-400">
                    {lastLogin ? formatRelative(lastLogin) : '—'}
                  </td>
                  <td className="px-5 py-3 text-gray-400">{formatRelative(user.created_at)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
