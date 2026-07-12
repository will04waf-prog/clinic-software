'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Plus, FileText } from 'lucide-react'
import { dict, type Locale } from '@/lib/i18n'
import { Button } from '@/components/ui/button'

type EstimateRow = {
  id: string
  estimate_number: number
  status: 'draft' | 'sent' | 'viewed' | 'approved' | 'expired' | 'void'
  total_cents: number
  title: string
  created_at: string
  first_name: string | null
}

function formatMoney(cents: number): string {
  return (cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function statusLabel(
  status: EstimateRow['status'],
  m: ReturnType<typeof dict>['estimate'],
  locale: Locale
): string {
  switch (status) {
    case 'draft':    return m.statusDraft
    case 'sent':     return m.statusSent
    case 'viewed':   return m.statusViewed
    case 'approved': return m.statusApproved
    // No i18n key for expired/void yet — local literals (noted to orchestrator).
    case 'expired':  return locale === 'en' ? 'Expired' : 'Vencido'
    case 'void':     return locale === 'en' ? 'Void' : 'Anulado'
    default:         return status
  }
}

function statusClasses(status: EstimateRow['status']): string {
  switch (status) {
    case 'approved': return 'bg-emerald-100 text-emerald-800'
    case 'sent':     return 'bg-sky-100 text-sky-800'
    case 'viewed':   return 'bg-violet-100 text-violet-800'
    case 'expired':  return 'bg-gray-200 text-gray-600'
    case 'void':     return 'bg-gray-200 text-gray-600'
    default:         return 'bg-amber-100 text-amber-800' // draft
  }
}

export function EstimatesList({ locale }: { locale: Locale }) {
  const m = dict(locale).estimate
  const [rows, setRows] = useState<EstimateRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/estimates', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data) => { if (!cancelled) setRows(data) })
      .catch(() => { if (!cancelled) setError('error') })
    return () => { cancelled = true }
  }, [])

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6">
      <div className="mb-6 flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-[#14241d]">{dict(locale).dashboard.estimates}</h1>
        <Button asChild size="sm">
          <Link href="/estimates/new">
            <Plus className="h-4 w-4" />
            {dict(locale).dashboard.newEstimate}
          </Link>
        </Button>
      </div>

      {rows === null && !error && (
        <div className="space-y-3 animate-pulse">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 rounded-xl bg-black/5" />
          ))}
        </div>
      )}

      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {dict(locale).common.loading}
        </p>
      )}

      {rows !== null && rows.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-gray-300 bg-white/60 px-6 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-100 text-brand-700">
            <FileText className="h-6 w-6" />
          </div>
          <p className="text-sm text-gray-600">{m.empty}</p>
          <Button asChild size="sm">
            <Link href="/estimates/new">
              <Plus className="h-4 w-4" />
              {dict(locale).dashboard.newEstimate}
            </Link>
          </Button>
        </div>
      )}

      {rows !== null && rows.length > 0 && (
        <ul className="space-y-2">
          {rows.map((e) => (
            <li key={e.id}>
              <Link
                href={`/estimates/${e.id}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm transition-colors hover:bg-gray-50 active:bg-gray-100"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[#14241d]">{e.title}</p>
                  <p className="truncate text-xs text-gray-500">
                    {m.number(e.estimate_number)}
                    {e.first_name ? ` · ${e.first_name}` : ''}
                  </p>
                </div>
                <div className="flex flex-none flex-col items-end gap-1">
                  <span className="text-sm font-semibold tabular-nums text-[#14241d]">
                    ${formatMoney(e.total_cents)}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${statusClasses(e.status)}`}>
                    {statusLabel(e.status, m, locale)}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
