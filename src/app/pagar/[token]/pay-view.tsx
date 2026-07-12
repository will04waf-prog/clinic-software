'use client'

import { useState } from 'react'
import { CreditCard, Check, Lock } from 'lucide-react'
import { dict, type Locale } from '@/lib/i18n'

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`

/** Interactive pay screen: invoice summary + "Pay by card" → Stripe Checkout. */
export function PayView({
  token,
  locale,
  businessName,
  invoiceNumber,
  totalCents,
  balanceCents,
}: {
  token: string
  locale: Locale
  businessName: string
  invoiceNumber: number
  totalCents: number
  balanceCents: number
}) {
  const t = dict(locale).pay
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const partiallyPaid = balanceCents < totalCents

  async function pay() {
    setError('')
    setLoading(true)
    try {
      const res = await fetch(`/api/pay/${token}/checkout`, { method: 'POST' })
      const body = await res.json().catch(() => null)
      if (!res.ok || !body?.url) {
        setError(t.errorGeneric)
        setLoading(false)
        return
      }
      window.location.href = body.url as string
    } catch {
      setError(t.errorGeneric)
      setLoading(false)
    }
  }

  return (
    <Shell locale={locale}>
      <p className="text-center text-sm font-medium text-gray-500">{t.fromBusiness(businessName)}</p>
      <h1 className="mt-1 text-center text-xl font-bold text-gray-900">{t.number(invoiceNumber)}</h1>

      <div className="mt-5 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-gray-500">{t.total}</span>
          <span className="tabular-nums text-base font-semibold text-gray-900">{money(totalCents)}</span>
        </div>
        <div className="mt-2 flex items-baseline justify-between border-t border-gray-100 pt-3">
          <span className="text-sm font-semibold text-gray-900">{t.balance}</span>
          <span className="tabular-nums text-2xl font-bold text-[#028090]">{money(balanceCents)}</span>
        </div>
        {partiallyPaid && (
          <p className="mt-1 text-right text-xs text-gray-400">{money(totalCents - balanceCents)} · {t.total.toLowerCase()}</p>
        )}
      </div>

      {error && <p className="mt-4 text-center text-sm text-red-600">{error}</p>}

      <button
        type="button"
        onClick={pay}
        disabled={loading}
        className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-brand px-5 py-4 text-base font-semibold text-white transition-transform active:scale-[.99] disabled:opacity-60"
      >
        {loading ? (
          t.opening
        ) : (
          <>
            <CreditCard className="h-5 w-5" /> {t.payCta}
          </>
        )}
      </button>

      <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-gray-400">
        <Lock className="h-3.5 w-3.5" /> {t.secure}
      </p>
    </Shell>
  )
}

type StatusKind = 'paid' | 'alreadyPaid' | 'notAvailable' | 'notFound'

/** Terminal states — success + the various "can't pay" outcomes. */
export function PayStatus({
  kind,
  locale,
  businessName = 'Tarhunna',
}: {
  kind: StatusKind
  locale: Locale
  businessName?: string
}) {
  const t = dict(locale).pay

  const isSuccess = kind === 'paid' || kind === 'alreadyPaid'
  const title =
    kind === 'paid' ? t.paidTitle : kind === 'alreadyPaid' ? t.paidTitle : kind === 'notFound' ? t.notFound : t.notAvailable
  const body =
    kind === 'paid' ? t.paidBody(businessName) : kind === 'alreadyPaid' ? t.alreadyPaid : null

  return (
    <Shell locale={locale}>
      <div className="flex flex-col items-center text-center">
        {isSuccess ? (
          <span className="grid h-16 w-16 place-items-center rounded-full bg-[#02C39A]/15 text-[#0B7A5E]">
            <Check className="h-8 w-8" />
          </span>
        ) : (
          <span className="grid h-16 w-16 place-items-center rounded-full bg-gray-100 text-gray-400">
            <CreditCard className="h-8 w-8" />
          </span>
        )}
        <h1 className="mt-4 text-xl font-bold text-gray-900">{title}</h1>
        {body && <p className="mt-2 text-sm text-gray-600">{body}</p>}
      </div>
    </Shell>
  )
}

function Shell({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  const t = dict(locale).pay
  return (
    <div className="flex min-h-dvh flex-col bg-[#F5EFE1]">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-10">
        {children}
        <p className="mt-8 text-center text-[11px] uppercase tracking-wider text-[#7E8C90]">{t.poweredBy}</p>
      </div>
    </div>
  )
}
