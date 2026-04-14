import { notFound } from 'next/navigation'
import Link from 'next/link'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { AccountEditForm } from '@/components/admin/account-edit-form'
import { formatRelative } from '@/lib/utils'

const PLAN_STATUS_COLORS: Record<string, string> = {
  active:   'bg-emerald-100 text-emerald-700',
  past_due: 'bg-yellow-100 text-yellow-700',
  canceled: 'bg-red-100 text-red-700',
}

export default async function AdminAccountDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('*')
    .eq('id', id)
    .single()

  if (!org) notFound()

  const [
    { count: userCount },
    { count: contactCount },
    { count: consultationCount },
    { count: messageCount },
    { data: users },
  ] = await Promise.all([
    supabaseAdmin.from('profiles').select('*', { count: 'exact', head: true }).eq('organization_id', id),
    supabaseAdmin.from('contacts').select('*', { count: 'exact', head: true }).eq('organization_id', id).eq('is_archived', false),
    supabaseAdmin.from('consultations').select('*', { count: 'exact', head: true }).eq('organization_id', id),
    supabaseAdmin.from('messages').select('*', { count: 'exact', head: true }).eq('organization_id', id),
    supabaseAdmin.from('profiles').select('id, full_name, email, role, created_at').eq('organization_id', id).order('created_at'),
  ])

  const usage = [
    { label: 'Users',         value: userCount        ?? 0 },
    { label: 'Contacts',      value: contactCount     ?? 0 },
    { label: 'Consultations', value: consultationCount ?? 0 },
    { label: 'Messages Sent', value: messageCount     ?? 0 },
  ]

  return (
    <div className="flex-1 overflow-y-auto p-8 max-w-3xl">
      <div className="mb-6">
        <Link href="/admin/accounts" className="text-xs text-gray-400 hover:text-gray-600">← Accounts</Link>
        <h1 className="text-xl font-bold text-gray-900 mt-1">{org.name}</h1>
        <p className="text-sm text-gray-500">{org.slug}</p>
      </div>

      <div className="space-y-4">
        {/* Org details */}
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Organization Details</h2>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <div><dt className="text-gray-500">Email</dt><dd className="text-gray-900 mt-0.5">{org.email ?? '—'}</dd></div>
            <div><dt className="text-gray-500">Phone</dt><dd className="text-gray-900 mt-0.5">{org.phone ?? '—'}</dd></div>
            <div><dt className="text-gray-500">Website</dt><dd className="text-gray-900 mt-0.5">{org.website ?? '—'}</dd></div>
            <div><dt className="text-gray-500">Timezone</dt><dd className="text-gray-900 mt-0.5">{org.timezone}</dd></div>
            <div><dt className="text-gray-500">Created</dt><dd className="text-gray-900 mt-0.5">{formatRelative(org.created_at)}</dd></div>
            <div>
              <dt className="text-gray-500">Plan Status</dt>
              <dd className="mt-0.5">
                <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${PLAN_STATUS_COLORS[org.plan_status] ?? 'bg-gray-100 text-gray-600'}`}>
                  {org.plan_status}
                </span>
              </dd>
            </div>
          </dl>
        </div>

        {/* Usage snapshot */}
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Usage</h2>
          <div className="grid grid-cols-4 gap-4">
            {usage.map(({ label, value }) => (
              <div key={label} className="text-center">
                <p className="text-2xl font-bold text-gray-900">{value}</p>
                <p className="text-xs text-gray-500 mt-0.5">{label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Users */}
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-900">Users</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="px-5 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Name</th>
                <th className="px-5 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Email</th>
                <th className="px-5 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Role</th>
                <th className="px-5 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(users ?? []).map((u) => (
                <tr key={u.id} className="hover:bg-gray-50">
                  <td className="px-5 py-2.5 font-medium text-gray-900">{u.full_name}</td>
                  <td className="px-5 py-2.5 text-gray-600">{u.email}</td>
                  <td className="px-5 py-2.5 text-gray-600 capitalize">{u.role}</td>
                  <td className="px-5 py-2.5 text-gray-400">{formatRelative(u.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Editable: plan + notes */}
        <AccountEditForm
          orgId={org.id}
          plan={org.plan}
          planStatus={org.plan_status}
          adminNotes={(org as any).admin_notes ?? null}
        />
      </div>
    </div>
  )
}
