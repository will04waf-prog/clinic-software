'use client'

import { useState } from 'react'
import { CreditCard, Check } from 'lucide-react'
import { dict, type Locale } from '@/lib/i18n'

export type ConnectStatus = 'inactive' | 'pending' | 'active'

/**
 * Owner-facing Settings card to turn on card payments (Stripe Connect
 * Express). Localized by the owner's language. The button POSTs to
 * /api/connect/onboard and forwards to Stripe's hosted onboarding; the
 * server's return_url bounces back and syncs status.
 */
export function ConnectPaymentsCard({
  locale,
  status,
}: {
  locale: Locale
  status: ConnectStatus
}) {
  const t = dict(locale).connect
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [comingSoon, setComingSoon] = useState(false)

  async function start() {
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/connect/onboard', { method: 'POST' })
      const body = await res.json().catch(() => null)
      if (!res.ok || !body?.url) {
        if (body?.error === 'connect_not_ready') {
          setComingSoon(true)
        } else {
          setError(t.errorGeneric)
        }
        setLoading(false)
        return
      }
      window.location.href = body.url as string
    } catch {
      setError(t.errorGeneric)
      setLoading(false)
    }
  }

  const pill =
    status === 'active'
      ? { label: t.statusActive, cls: 'bg-[#02C39A]/15 text-[#0B7A5E]' }
      : status === 'pending'
        ? { label: t.statusPending, cls: 'bg-amber-100 text-amber-800' }
        : { label: t.statusInactive, cls: 'bg-gray-100 text-gray-600' }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#028090]/10 text-[#028090]">
            <CreditCard className="h-5 w-5" />
          </span>
          <h3 className="text-base font-semibold text-gray-900">{t.title}</h3>
        </div>
        <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${pill.cls}`}>
          {pill.label}
        </span>
      </div>

      <p className="mt-3 text-sm text-gray-600">{t.subtitle}</p>

      {status === 'active' ? (
        <div className="mt-4 space-y-2">
          <p className="flex items-center gap-2 text-sm font-medium text-[#0B7A5E]">
            <Check className="h-4 w-4" /> {t.activeNote}
          </p>
          <p className="text-xs text-gray-400">{t.rateNote}</p>
        </div>
      ) : (
        <>
          {status === 'pending' && <p className="mt-3 text-sm text-amber-700">{t.pendingNote}</p>}
          <p className="mt-2 text-xs text-gray-400">{t.rateNote}</p>
          {comingSoon && (
            <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-800">{t.comingSoon}</p>
          )}
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
          <button
            type="button"
            onClick={start}
            disabled={loading}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-brand px-5 py-3 text-sm font-semibold text-white transition-transform active:scale-[.99] disabled:opacity-60 sm:w-auto"
          >
            {loading ? t.starting : status === 'pending' ? t.continueCta : t.activateCta}
          </button>
        </>
      )}
    </div>
  )
}
