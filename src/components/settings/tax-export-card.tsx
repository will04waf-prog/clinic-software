'use client'

import { useState } from 'react'
import { FileSpreadsheet, Download } from 'lucide-react'
import { dict, type Locale } from '@/lib/i18n'

/**
 * Tax-time export card (loop orgs, owner-only). Four CSV downloads per
 * year — invoices, payments, clients, income summary — served by
 * /api/export/tax-package. Plain <a> downloads: the route streams a
 * Content-Disposition attachment, no client state needed.
 */
export function TaxExportCard({ locale }: { locale: Locale }) {
  const t = dict(locale).taxExport
  const thisYear = new Date().getFullYear()
  // Current + two prior years covers "my preparer asked for last year"
  // well past the April deadline.
  const years = [thisYear, thisYear - 1, thisYear - 2]
  const [year, setYear] = useState(thisYear)

  const files = [
    { key: 'summary', label: t.fileSummary },
    { key: 'invoices', label: t.fileInvoices },
    { key: 'payments', label: t.filePayments },
    { key: 'clients', label: t.fileClients },
  ] as const

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#02C39A]/15 text-[#028090]">
          <FileSpreadsheet className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-gray-900">{t.title}</h3>
          <p className="mt-0.5 text-sm leading-relaxed text-gray-500">{t.sub}</p>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <label className="text-xs font-medium text-gray-600" htmlFor="tax-export-year">{t.yearLabel}</label>
        <select
          id="tax-export-year"
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 focus:border-[#028090] focus:outline-none"
        >
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      <ul className="mt-3 divide-y divide-gray-100 rounded-xl border border-gray-100">
        {files.map(f => (
          <li key={f.key} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <span className="text-sm text-gray-700">{f.label}</span>
            <a
              href={`/api/export/tax-package?year=${year}&file=${f.key}`}
              download
              className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-[#028090]/30 px-3.5 text-xs font-semibold text-[#028090] transition-colors hover:bg-[#028090]/5"
            >
              <Download className="h-3.5 w-3.5" /> {t.download}
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}
