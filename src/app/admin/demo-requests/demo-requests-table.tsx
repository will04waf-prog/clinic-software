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
  // Handle ISO date strings (YYYY-MM-DD) from the date input
  const parts = date.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (parts) {
    const d = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]))
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }
  // Fallback: return as-is for legacy free-text values
  return date
}

const STATUS_COLORS: Record<string, string> = {
  new: 'bg-blue-50 text-blue-700',
  booked: 'bg-green-50 text-green-700',
  completed: 'bg-gray-100 text-gray-600',
  cancelled: 'bg-red-50 text-red-600',
}

const STATUSES = ['new', 'booked', 'completed', 'cancelled']

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
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Contact</th>
            <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Clinic</th>
            <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Preferred Date</th>
            <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Notes</th>
            <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Source</th>
            <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Received</th>
            <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-100">
          {rows.map((req) => (
            <tr key={req.id} className="hover:bg-gray-50 transition-colors">
              <td className="px-5 py-3">
                <div className="font-medium text-gray-900 text-sm">{req.name}</div>
                <a
                  href={`mailto:${req.email}`}
                  className="text-xs text-indigo-600 hover:underline"
                >
                  {req.email}
                </a>
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
              <td className="px-5 py-3 text-xs text-gray-400">
                <div>{req.page_path || '—'}</div>
                {req.source && req.source !== 'direct' && (
                  <div className="truncate max-w-[120px]" title={req.source}>{req.source}</div>
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
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
