'use client'

/**
 * Client view for /aprobar/[token] — the Spanish-first, mobile-first
 * estimate approval surface the CUSTOMER sees.
 *
 * Shows who sent it, the line items + total (rendered from cents), and a
 * big "Aprobar estimado" button that POSTs { token } to
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
  /** Business contact phone — rendered as a tel: link when present. */
  orgPhone?: string | null
  title: string
  /** Receipt identity: estimate number + sent date + validity window. */
  estimateNumber?: number | null
  createdAt?: string | null
  /** Owner-authored notes/terms, shown verbatim under the line items. */
  notes?: string | null
  lineItems: LineItem[]
  subtotalCents: number
  taxCents: number
  totalCents: number
  currency: string
}

/** Estimates hold their price for 30 days from creation — computed, not
 *  stored: adding a column for a fixed policy would be schema for its
 *  own sake. If the policy ever becomes per-org, THEN it earns a column. */
const VALIDITY_DAYS = 30

function useDates(createdAt: string | null | undefined, locale: Locale) {
  return useMemo(() => {
    if (!createdAt) return { issued: null as string | null, validUntil: null as string | null }
    const created = new Date(createdAt)
    if (Number.isNaN(created.getTime())) return { issued: null, validUntil: null }
    const until = new Date(created.getTime() + VALIDITY_DAYS * 86_400_000)
    const fmt = new Intl.DateTimeFormat(locale === 'es' ? 'es-US' : 'en-US', {
      day: 'numeric', month: 'long', year: 'numeric',
    })
    return { issued: fmt.format(created), validUntil: fmt.format(until) }
  }, [createdAt, locale])
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
  const {
    token, locale, orgName, orgPhone, title, estimateNumber, createdAt,
    notes, lineItems, subtotalCents, taxCents, totalCents, currency,
  } = props
  const t = dict(locale)
  const money = useMoney(currency, locale)
  const { issued, validUntil } = useDates(createdAt, locale)

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
          <h1 className="text-[19px] font-semibold text-[#0B2027]">{t.approve.approvedTitle}</h1>
          <p className="text-[14px] leading-relaxed text-[#4A5A60]">{t.approve.approvedBody(orgName)}</p>
          <p className="pt-2 text-[12.5px] text-[#7E8C90]">{t.approve.questions}</p>
        </div>
      </Shell>
    )
  }

  return (
    <Shell locale={locale}>
      <header className="mb-5">
        <h1 className="text-[19px] font-semibold leading-tight text-[#0B2027]">
          {t.approve.fromBusiness(orgName)}
        </h1>
        {title && <p className="mt-1 text-[13.5px] text-[#7E8C90]">{title}</p>}
        {/* Receipt identity line: number · sent date. Validity below it. */}
        {(estimateNumber != null || issued) && (
          <p className="mt-2 text-[12.5px] text-[#7E8C90]">
            {estimateNumber != null && <span className="font-medium text-[#4A5A60]">{t.approve.estimateNo(estimateNumber)}</span>}
            {estimateNumber != null && issued && ' · '}
            {issued && t.approve.issued(issued)}
          </p>
        )}
        {validUntil && (
          <p className="mt-0.5 text-[12.5px] text-[#7E8C90]">{t.approve.validity(validUntil)}</p>
        )}
      </header>

      <div className="overflow-hidden rounded-xl border border-[#0B2027]/10">
        <ul className="divide-y divide-[#0B2027]/10">
          {lineItems.map((li) => (
            <li key={li.id} className="flex items-start justify-between gap-3 bg-white px-4 py-3">
              <div className="min-w-0">
                <p className="text-[14px] text-[#0B2027]">{li.description}</p>
                <p className="mt-0.5 text-[12px] text-[#7E8C90]">
                  {li.quantity} × {money(li.unitPriceCents)}
                </p>
              </div>
              <p className="shrink-0 text-[14px] font-medium text-[#0B2027]">
                {money(li.quantity * li.unitPriceCents)}
              </p>
            </li>
          ))}
        </ul>

        <div className="space-y-1.5 bg-[#F5EFE1]/60 px-4 py-3 text-[13px]">
          <Row label={t.estimate.subtotal} value={money(subtotalCents)} />
          {taxCents > 0 && <Row label={t.estimate.tax} value={money(taxCents)} />}
          <div className="flex items-center justify-between pt-1.5 text-[16px] font-semibold text-[#0B2027]">
            <span>{t.approve.total}</span>
            <span>{money(totalCents)}</span>
          </div>
        </div>
      </div>

      {/* Owner-authored notes/terms — verbatim, whitespace preserved. */}
      {notes && notes.trim() && (
        <div className="mt-4 rounded-xl border border-[#0B2027]/10 bg-white px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#7E8C90]">{t.approve.notesTitle}</p>
          <p className="mt-1.5 whitespace-pre-line text-[13px] leading-relaxed text-[#4A5A60]">{notes.trim()}</p>
        </div>
      )}

      {/* ¿Qué sigue? — sets expectations before the tap. */}
      <div className="mt-4 rounded-xl bg-[#F5EFE1]/60 px-4 py-3.5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[#7E8C90]">{t.approve.whatsNextTitle}</p>
        <ol className="mt-2 space-y-1.5">
          {t.approve.whatsNextSteps(orgName).map((step, i) => (
            <li key={i} className="flex items-start gap-2.5 text-[13px] leading-relaxed text-[#4A5A60]">
              <span className="mt-0.5 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full bg-[#028090]/10 text-[10.5px] font-semibold text-[#028090]">{i + 1}</span>
              {step}
            </li>
          ))}
        </ol>
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

      {/* Contact: a tel: link when the business has a phone on file —
          the WhatsApp-reply line otherwise. */}
      {orgPhone ? (
        <p className="mt-4 text-center text-[12.5px] text-[#7E8C90]">
          <a href={`tel:${orgPhone}`} className="underline decoration-[#7E8C90]/40 underline-offset-2">
            {t.approve.callBusiness(orgPhone)}
          </a>
        </p>
      ) : (
        <p className="mt-4 text-center text-[12.5px] text-[#7E8C90]">{t.approve.questions}</p>
      )}
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
      <div className="mx-auto w-full max-w-md rounded-2xl border border-[#0B2027]/10 bg-white p-5 shadow-sm sm:p-6">
        {children}
      </div>
      <p className="mx-auto mt-5 max-w-md text-center text-[11px] uppercase tracking-wider text-[#7E8C90]">
        {t.approve.poweredBy}
      </p>
    </div>
  )
}
