'use client'
import { useState } from 'react'
import { formatRelative } from '@/lib/utils'

type DemoRequest = {
  id: string
  name: string
  clinic_name: string
  email: string
  phone: string | null
  preferred_date: string | null
  preferred_time: string | null
  notes: string | null
  status: string
  source: string | null
  page_path: string | null
  created_at: string
}

function formatPreferredDate(date: string | null) {
  if (!date) return null
  const parts = date.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (parts) {
    const d = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]))
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }
  return date
}

const STATUS_COLORS: Record<string, string> = {
  new:       'bg-blue-50 text-blue-700',
  contacted: 'bg-amber-50 text-amber-700',
  booked:    'bg-green-50 text-green-700',
  completed: 'bg-gray-100 text-gray-600',
  cancelled: 'bg-red-50 text-red-600',
}

const STATUSES = ['new', 'contacted', 'booked', 'completed', 'cancelled']

// Quick actions shown per status — only the most useful next step(s)
function QuickActions({
  req,
  updating,
  onUpdate,
}: {
  req: DemoRequest
  updating: string | null
  onUpdate: (id: string, status: string) => void
}) {
  const busy = updating === req.id

  return (
    <div className="flex flex-col gap-1.5">
      {/* Email — always shown */}
      <a
        href={`mailto:${req.email}?subject=Re: Demo request for ${encodeURIComponent(req.clinic_name)}`}
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium border border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-colors whitespace-nowrap"
      >
        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
        Email
      </a>

      {/* Mark Contacted — shown when new */}
      {req.status === 'new' && (
        <button
          disabled={busy}
          onClick={() => onUpdate(req.id, 'contacted')}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-amber-50 text-amber-700 hover:bg-amber-100 disabled:opacity-50 transition-colors whitespace-nowrap"
        >
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          Mark contacted
        </button>
      )}

      {/* Mark Booked — shown when new or contacted */}
      {(req.status === 'new' || req.status === 'contacted') && (
        <button
          disabled={busy}
          onClick={() => onUpdate(req.id, 'booked')}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-green-50 text-green-700 hover:bg-green-100 disabled:opacity-50 transition-colors whitespace-nowrap"
        >
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          Mark booked
        </button>
      )}

      {/* Mark Completed — shown when booked */}
      {req.status === 'booked' && (
        <button
          disabled={busy}
          onClick={() => onUpdate(req.id, 'completed')}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-50 transition-colors whitespace-nowrap"
        >
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Mark completed
        </button>
      )}
    </div>
  )
}

export function DemoRequestsTable({ requests }: { requests: DemoRequest[] }) {
  const [rows, setRows] = useState(requests)
  const [updating, setUpdating] = useState<string | null>(null)

  async function updateStatus(id: string, status: string) {
    setUpdating(id)
    try {
      const res = await fetch('/api/admin/demo-requests', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      })
      if (res.ok) {
        setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)))
      }
    } finally {
      setUpdating(null)
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Contact</th>
            <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Clinic</th>
            <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Preferred Date</th>
            <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Notes</th>
            <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Received</th>
            <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
            <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-100">
          {rows.map((req) => (
            <tr key={req.id} className="hover:bg-gray-50 transition-colors">
              <td className="px-5 py-3">
                <div className="font-medium text-gray-900 text-sm">{req.name}</div>
                <div className="text-xs text-gray-400 mt-0.5">{req.email}</div>
                {req.phone && (
                  <div className="text-xs text-gray-400 mt-0.5">{req.phone}</div>
                )}
              </td>
              <td className="px-5 py-3 text-sm text-gray-700">{req.clinic_name}</td>
              <td className="px-5 py-3 text-sm text-gray-500 whitespace-nowrap">
                {formatPreferredDate(req.preferred_date) ?? <span className="text-gray-300">—</span>}
                {req.preferred_time && (
                  <div className="text-xs text-gray-400 mt-0.5">{req.preferred_time} ET</div>
                )}
              </td>
              <td className="px-5 py-3 text-sm text-gray-500 max-w-xs">
                {req.notes ? (
                  <span title={req.notes} className="line-clamp-2">{req.notes}</span>
                ) : (
                  <span className="text-gray-300">—</span>
                )}
              </td>
              <td className="px-5 py-3 text-sm text-gray-400 whitespace-nowrap">
                {formatRelative(req.created_at)}
              </td>
              <td className="px-5 py-3">
                <select
                  value={req.status}
                  disabled={updating === req.id}
                  onChange={(e) => updateStatus(req.id, e.target.value)}
                  className={[
                    'text-xs font-medium rounded-full px-2.5 py-1 border-0 cursor-pointer focus:ring-2 focus:ring-indigo-500',
                    STATUS_COLORS[req.status] ?? 'bg-gray-100 text-gray-600',
                    updating === req.id ? 'opacity-50' : '',
                  ].join(' ')}
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s.charAt(0).toUpperCase() + s.slice(1)}
                    </option>
                  ))}
                </select>
              </td>
              <td className="px-5 py-3">
                <QuickActions req={req} updating={updating} onUpdate={updateStatus} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
