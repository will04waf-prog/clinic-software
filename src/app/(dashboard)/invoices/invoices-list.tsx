'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Plus, Receipt } from 'lucide-react'
import { dict, type Locale } from '@/lib/i18n'
import { Button } from '@/components/ui/button'

type InvoiceRow = {
  id: string
  invoice_number: number
  status: 'draft' | 'sent' | 'paid' | 'void'
  total_cents: number
  amount_paid_cents: number
  title: string | null
  created_at: string
  first_name: string | null
}

function formatMoney(cents: number): string {
  return (cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function statusLabel(status: InvoiceRow['status'], m: ReturnType<typeof dict>['invoice']): string {
  switch (status) {
    case 'draft': return m.statusDraft
    case 'sent':  return m.statusSent
    case 'paid':  return m.statusPaid
    case 'void':  return m.statusVoid
    default:      return status
  }
}

function statusClasses(status: InvoiceRow['status']): string {
  switch (status) {
    case 'paid': return 'bg-[#02C39A]/15 text-[#0B7A5E]'
    case 'sent': return 'bg-[#028090]/10 text-[#028090]'
    case 'void': return 'bg-gray-200 text-gray-600'
    default:     return 'bg-amber-100 text-amber-800' // draft
  }
}

export function InvoicesList({ locale }: { locale: Locale }) {
  const m = dict(locale).invoice
  const [rows, setRows] = useState<InvoiceRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/invoices', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data) => { if (!cancelled) setRows(data) })
      .catch(() => { if (!cancelled) setError('error') })
    return () => { cancelled = true }
  }, [])

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6">
      <div className="mb-6 flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-[#14241d]">{dict(locale).nav.invoices}</h1>
        <Button asChild size="sm">
          <Link href="/invoices/new">
            <Plus className="h-4 w-4" />
            {m.newTitle}
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
            <Receipt className="h-6 w-6" />
          </div>
          <p className="text-sm text-gray-600">{m.empty}</p>
          <Button asChild size="sm">
            <Link href="/invoices/new">
              <Plus className="h-4 w-4" />
              {m.newTitle}
            </Link>
          </Button>
        </div>
      )}

      {rows !== null && rows.length > 0 && (
        <ul className="space-y-2">
          {rows.map((inv) => {
            const balance = Math.max(0, inv.total_cents - inv.amount_paid_cents)
            return (
              <li key={inv.id}>
                <Link
                  href={`/invoices/${inv.id}`}
                  className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm transition-colors hover:bg-gray-50 active:bg-gray-100"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[#14241d]">
                      {inv.title || m.number(inv.invoice_number)}
                    </p>
                    <p className="truncate text-xs text-gray-500">
                      {m.number(inv.invoice_number)}
                      {inv.first_name ? ` · ${inv.first_name}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-none flex-col items-end gap-1">
                    <span className="text-sm font-semibold tabular-nums text-[#14241d]">
                      ${formatMoney(inv.total_cents)}
                    </span>
                    {inv.status !== 'paid' && balance > 0 ? (
                      <span className="text-[11px] tabular-nums text-gray-500">
                        {m.balance}: ${formatMoney(balance)}
                      </span>
                    ) : (
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${statusClasses(inv.status)}`}>
                        {statusLabel(inv.status, m)}
                      </span>
                    )}
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
