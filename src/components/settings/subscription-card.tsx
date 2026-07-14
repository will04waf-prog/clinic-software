'use client'

import { useState } from 'react'
import { Check, ShieldCheck } from 'lucide-react'
import { dict, type Locale } from '@/lib/i18n'

/**
 * CRM-pivot SaaS plan card ($39/mo). Shown in Settings for CRM
 * (landscaping) orgs in place of the med-spa tier BillingCard. Localized.
 * The button POSTs to /api/billing/subscribe, which returns a Checkout
 * URL (or a billing-portal URL if already subscribed).
 */
export function SubscriptionCard({
  locale,
  planStatus,
  trialEndsAt,
}: {
  locale: Locale
  planStatus: string
  trialEndsAt: string | null
}) {
  const t = dict(locale).subscription
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const isActive = planStatus === 'active'
  const isPastDue = planStatus === 'past_due'
  const daysLeft = trialEndsAt
    ? Math.max(0, Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / 86_400_000))
    : 0
  const onTrial = planStatus === 'trial' && daysLeft > 0

  const statusLine = isActive
    ? t.active
    : isPastDue
      ? t.pastDue
      : onTrial
        ? t.trialActive(daysLeft)
        : t.trialEnded

  async function go() {
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/billing/subscribe', { method: 'POST' })
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
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-gray-900">{t.title}</h3>
          <p className="mt-0.5 text-sm text-gray-500">
            {t.planName} · <span className="font-medium text-gray-700">{t.priceLine}</span>
          </p>
        </div>
        {isActive && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#02C39A]/15 px-3 py-1 text-xs font-semibold text-[#0B7A5E]">
            <Check className="h-3.5 w-3.5" /> {t.active}
          </span>
        )}
      </div>

      <p className={`mt-3 text-sm ${isPastDue ? 'text-red-600' : 'text-gray-600'}`}>{statusLine}</p>
      {!isActive && <p className="mt-1 text-xs text-gray-400">{t.noCardNote}</p>}
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <button
        type="button"
        onClick={go}
        disabled={loading}
        className="mt-4 inline-flex w-full items-center justify-center rounded-xl bg-gradient-brand px-5 py-3 text-sm font-semibold text-white transition-transform active:scale-[.99] disabled:opacity-60 sm:w-auto"
      >
        {loading ? t.starting : isActive ? t.manageCta : t.subscribeCta}
      </button>

      {/* No-lock-in reassurance — the differentiator against competitors'
          predatory-billing reputation. Always visible. */}
      <p className="mt-3 flex items-start gap-1.5 text-xs text-gray-500">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#02C39A]" /> {t.lockIn}
      </p>
    </div>
  )
}
