import { supabaseAdmin } from '@/lib/supabase/admin'
import { formatRelative } from '@/lib/utils'
import { DemoRequestsTable } from './demo-requests-table'

export const metadata = { title: 'Demo Requests | Tarhunna Admin' }
export const dynamic = 'force-dynamic'

export default async function DemoRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  const { status = 'new' } = await searchParams

  let query = supabaseAdmin
    .from('demo_requests')
    .select('*')
    .order('created_at', { ascending: false })

  if (status !== 'all') {
    query = query.eq('status', status)
  }

  const { data: requests } = await query

  const counts = await Promise.all([
    supabaseAdmin.from('demo_requests').select('id', { count: 'exact', head: true }).eq('status', 'new'),
    supabaseAdmin.from('demo_requests').select('id', { count: 'exact', head: true }).eq('status', 'contacted'),
    supabaseAdmin.from('demo_requests').select('id', { count: 'exact', head: true }).eq('status', 'booked'),
    supabaseAdmin.from('demo_requests').select('id', { count: 'exact', head: true }),
  ])

  const newCount       = counts[0].count ?? 0
  const contactedCount = counts[1].count ?? 0
  const bookedCount    = counts[2].count ?? 0
  const allCount       = counts[3].count ?? 0

  const tabs = [
    { label: 'New',       value: 'new',       count: newCount },
    { label: 'Contacted', value: 'contacted',  count: contactedCount },
    { label: 'Booked',    value: 'booked',     count: bookedCount },
    { label: 'All',       value: 'all',        count: allCount },
  ]

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Demo Requests</h1>
        <p className="text-sm text-gray-500 mt-1">Incoming requests from the public book-a-demo form.</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {tabs.map((tab) => (
          <a
            key={tab.value}
            href={`/admin/demo-requests?status=${tab.value}`}
            className={[
              'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              status === tab.value
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700',
            ].join(' ')}
          >
            {tab.label}
            <span className="ml-1.5 text-xs text-gray-400">({tab.count})</span>
          </a>
        ))}
      </div>

      {/* Table */}
      {!requests || requests.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-12 text-center text-gray-400">
          No {status === 'all' ? '' : status} demo requests yet.
        </div>
      ) : (
        <DemoRequestsTable requests={requests} />
      )}
    </div>
  )
}
