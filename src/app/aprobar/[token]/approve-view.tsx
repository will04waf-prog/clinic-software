'use client'

/**
 * Client view for /aprobar/[token] — the Spanish-first, mobile-first
 * estimate approval surface the CUSTOMER sees.
 *
 * Shows who sent it, the line items + total (rendered from cents), and a
 * big "Aprobar presupuesto" button that POSTs { token } to
 * /api/estimates/approve. On success — including the idempotent
 * alreadyApproved answer — it swaps to the approved confirmation.
 *
 * All copy comes from dict(locale).approve.*; the locale is fixed by the
 * server from the contact's preferred_language (default es).
 */
import { useMemo, useState, type ReactNode } from 'react'
import { Check, Loader2, AlertCircle } from 'lucide-react'
import { dict, type Locale } from '@/lib/i18n'

interface LineItem {
  id: string
  description: string
  quantity: number
  unitPriceCents: number
}

export interface ApproveViewProps {
  token: string
  locale: Locale
  orgName: string
  title: string
  lineItems: LineItem[]
  subtotalCents: number
  taxCents: number
  totalCents: number
  currency: string
}

function useMoney(currency: string, locale: Locale) {
  return useMemo(() => {
    const code = (currency || 'usd').toUpperCase()
    const fmt = new Intl.NumberFormat(locale === 'es' ? 'es-US' : 'en-US', {
      style: 'currency',
      currency: code,
    })
    return (cents: number) => fmt.format((cents ?? 0) / 100)
  }, [currency, locale])
}

export function ApproveView(props: ApproveViewProps) {
  const { token, locale, orgName, title, lineItems, subtotalCents, taxCents, totalCents, currency } = props
  const t = dict(locale)
  const money = useMoney(currency, locale)

  const [status, setStatus] = useState<'idle' | 'submitting' | 'approved'>('idle')
  const [error, setError] = useState('')

  async function approve() {
    setStatus('submitting')
    setError('')
    try {
      const res = await fetch('/api/estimates/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const json = await res.json().catch(() => ({}))
      // ok OR alreadyApproved both land on the confirmation — a second
      // tap should reassure, not error.
      if (res.ok && (json.ok === true)) {
        setStatus('approved')
        return
      }
      setError(t.approve.expired)
      setStatus('idle')
    } catch {
      setError(locale === 'es' ? 'Problema de conexión. Intente de nuevo.' : 'Network problem. Please try again.')
      setStatus('idle')
    }
  }

  if (status === 'approved') {
    return (
      <Shell locale={locale}>
        <div className="space-y-4 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#02C39A]/15">
            <Check className="h-7 w-7 text-[#028090]" />
          </div>
          <h1 className="text-[19px] font-semibold text-[#14241d]">{t.approve.approvedTitle}</h1>
          <p className="text-[14px] leading-relaxed text-[#4A5A60]">{t.approve.approvedBody(orgName)}</p>
          <p className="pt-2 text-[12.5px] text-[#7E8C90]">{t.approve.questions}</p>
        </div>
      </Shell>
    )
  }

  return (
    <Shell locale={locale}>
      <header className="mb-5">
        <h1 className="text-[19px] font-semibold leading-tight text-[#14241d]">
          {t.approve.fromBusiness(orgName)}
        </h1>
        {title && <p className="mt-1 text-[13.5px] text-[#7E8C90]">{title}</p>}
      </header>

      <div className="overflow-hidden rounded-xl border border-[#14241d]/10">
        <ul className="divide-y divide-[#14241d]/10">
          {lineItems.map((li) => (
            <li key={li.id} className="flex items-start justify-between gap-3 bg-white px-4 py-3">
              <div className="min-w-0">
                <p className="text-[14px] text-[#14241d]">{li.description}</p>
                <p className="mt-0.5 text-[12px] text-[#7E8C90]">
                  {li.quantity} × {money(li.unitPriceCents)}
                </p>
              </div>
              <p className="shrink-0 text-[14px] font-medium text-[#14241d]">
                {money(li.quantity * li.unitPriceCents)}
              </p>
            </li>
          ))}
        </ul>

        <div className="space-y-1.5 bg-[#F5EFE1]/60 px-4 py-3 text-[13px]">
          <Row label={t.estimate.subtotal} value={money(subtotalCents)} />
          {taxCents > 0 && <Row label={t.estimate.tax} value={money(taxCents)} />}
          <div className="flex items-center justify-between pt-1.5 text-[16px] font-semibold text-[#14241d]">
            <span>{t.approve.total}</span>
            <span>{money(totalCents)}</span>
          </div>
        </div>
      </div>

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-[#B5710F]/30 bg-[#B5710F]/10 p-3 text-[12.5px] text-[#B5710F]">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <button
        type="button"
        onClick={approve}
        disabled={status === 'submitting'}
        className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#028090] px-4 py-4 text-[16px] font-semibold text-white shadow-sm transition active:scale-[0.99] hover:bg-[#026e7c] disabled:opacity-60"
      >
        {status === 'submitting' ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin" />
            {t.approve.approving}
          </>
        ) : (
          <>
            <Check className="h-5 w-5" />
            {t.approve.approveCta}
          </>
        )}
      </button>

      <p className="mt-4 text-center text-[12.5px] text-[#7E8C90]">{t.approve.questions}</p>
    </Shell>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-[#4A5A60]">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  )
}

function Shell({ locale, children }: { locale: Locale; children: ReactNode }) {
  const t = dict(locale)
  return (
    <div className="min-h-screen bg-[#F5EFE1] px-4 py-8">
      <div className="mx-auto w-full max-w-md rounded-2xl border border-[#14241d]/10 bg-white p-5 shadow-sm sm:p-6">
        {children}
      </div>
      <p className="mx-auto mt-5 max-w-md text-center text-[11px] uppercase tracking-wider text-[#7E8C90]">
        {t.approve.poweredBy}
      </p>
    </div>
  )
}
