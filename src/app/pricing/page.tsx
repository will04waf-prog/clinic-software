'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Logo } from '@/components/ui/logo'
import { createClient } from '@/lib/supabase/client'
import {
  TIER_DISPLAY_NAMES,
  TIER_PRICING,
  type TierId,
  type BillingPeriod,
} from '@/lib/billing/tiers'

// Annual total prices charged by Stripe (rounded to ".99" pricing). We display
// only this annual total in annual mode — not a per-month equivalent — because
// $1,399/year ÷ 12 = $116.58/mo while $147 × 0.80 = $117.60/mo. Showing the
// annual total avoids the small mismatch. Keep these in sync with the Stripe
// annual Price IDs (STRIPE_PRICE_*_ANNUAL).
const TIER_ANNUAL_TOTAL_CENTS: Record<TierId, number> = {
  starter:      139900,
  professional: 279900,
  scale:        479900,
}

const TIER_FEATURES: Record<TierId, string[]> = {
  starter: [
    'Up to 500 contacts',
    'Lead capture forms',
    'Pipeline & consultation tracking',
    'Manual messaging',
    '500 SMS messages/month',
    'Email support',
  ],
  professional: [
    'Up to 2,500 contacts',
    'Everything in Starter',
    'Automated email sequences',
    'Automated 24h/2h consultation reminders',
    'Bulk contact import',
    '2,000 SMS messages/month',
    'Priority email support',
  ],
  scale: [
    'Unlimited contacts',
    'Everything in Professional',
    'Multi-location support',
    'Advanced automation workflows',
    '5,000 SMS messages/month',
    'Phone & chat support',
    'Dedicated onboarding session',
  ],
}

const TIERS: TierId[] = ['starter', 'professional', 'scale']

function formatDollars(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

export default function PricingPage() {
  const [period,      setPeriod]      = useState<BillingPeriod>('monthly')
  const [loadingTier, setLoadingTier] = useState<TierId | null>(null)
  const [error,       setError]       = useState<string | null>(null)

  async function handleGetStarted(tier: TierId) {
    setLoadingTier(tier)
    setError(null)
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()

      if (!session) {
        // ?next=/pricing is a forward-looking placeholder — /signup doesn't
        // honor it yet, but plumbing it now means future signup-redirect
        // wiring won't need a content change here.
        window.location.href = '/signup?next=/pricing'
        return
      }

      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier, period }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok)   throw new Error(data.error ?? `HTTP ${res.status}`)
      if (!data.url) throw new Error('No checkout URL returned')
      window.location.href = data.url
    } catch (err: any) {
      setError(err.message ?? 'Something went wrong')
      setLoadingTier(null)
    }
  }

  return (
    <div className="min-h-screen bg-white flex flex-col">

      {/* Nav */}
      <header className="border-b border-gray-100">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <Logo size="sm" />
          </Link>
          <div className="flex items-center gap-5">
            <Link href="/pricing" className="text-sm text-gray-500 hover:text-gray-900 transition-colors">
              Pricing
            </Link>
            <Link href="/login" className="text-sm text-gray-500 hover:text-gray-900 transition-colors">
              Sign in
            </Link>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1">
        <div className="max-w-6xl mx-auto px-6 py-16">

          {/* Hero */}
          <div className="text-center mb-10">
            <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-3">
              Simple, transparent pricing
            </h1>
            <p className="text-gray-600 text-base sm:text-lg">
              Choose the plan that fits your clinic. Change or cancel anytime.
            </p>
          </div>

          {/* Toggle */}
          <div className="flex justify-center mb-10">
            <div role="group" aria-label="Billing period" className="inline-flex rounded-full border border-gray-200 bg-white p-1 text-sm">
              <button
                type="button"
                onClick={() => setPeriod('monthly')}
                aria-pressed={period === 'monthly'}
                className={`px-5 py-2 rounded-full transition-colors ${
                  period === 'monthly'
                    ? 'bg-gray-900 text-white'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Monthly
              </button>
              <button
                type="button"
                onClick={() => setPeriod('annual')}
                aria-pressed={period === 'annual'}
                className={`px-5 py-2 rounded-full transition-colors ${
                  period === 'annual'
                    ? 'bg-gray-900 text-white'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Annual
              </button>
            </div>
          </div>

          {error && (
            <div className="max-w-2xl mx-auto mb-6 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Pricing columns */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch">
            {TIERS.map((tier) => {
              const isPopular      = tier === 'professional'
              const name           = TIER_DISPLAY_NAMES[tier]
              const features       = TIER_FEATURES[tier]
              const monthlyDollars = formatDollars(TIER_PRICING[tier].monthlyCents)
              const annualDollars  = formatDollars(TIER_ANNUAL_TOTAL_CENTS[tier])

              return (
                <div
                  key={tier}
                  className={`relative flex flex-col rounded-2xl border bg-white p-7 ${
                    isPopular
                      ? 'border-indigo-200 shadow-lg ring-1 ring-indigo-100 md:-translate-y-2'
                      : 'border-gray-200 shadow-sm'
                  }`}
                >
                  {isPopular && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <span className="inline-flex items-center rounded-full bg-indigo-600 text-white px-3 py-1 text-xs font-medium">
                        Most Popular
                      </span>
                    </div>
                  )}

                  <h3 className="text-lg font-semibold text-gray-900 mb-1">{name}</h3>

                  {period === 'monthly' ? (
                    <>
                      <div className="mt-3 flex items-baseline gap-1">
                        <span className="text-4xl font-bold text-gray-900">{monthlyDollars}</span>
                        <span className="text-gray-500">/mo</span>
                      </div>
                      <p className="mt-1 text-sm text-gray-500">Billed monthly</p>
                    </>
                  ) : (
                    <>
                      <div className="mt-3 flex items-baseline gap-1">
                        <span className="text-4xl font-bold text-gray-900">{annualDollars}</span>
                        <span className="text-gray-500">/year</span>
                      </div>
                      <div className="mt-2">
                        <span className="inline-flex items-center rounded-full bg-emerald-100 text-emerald-700 px-2.5 py-0.5 text-xs font-medium">
                          Save 20%
                        </span>
                      </div>
                    </>
                  )}

                  <ul className="mt-6 space-y-3 text-sm text-gray-700 flex-1">
                    {features.map((feat) => (
                      <li key={feat} className="flex items-start gap-2">
                        <svg
                          className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5"
                          fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"
                          aria-hidden="true"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                        <span>{feat}</span>
                      </li>
                    ))}
                  </ul>

                  <button
                    type="button"
                    onClick={() => handleGetStarted(tier)}
                    disabled={loadingTier !== null}
                    className={`mt-8 w-full rounded-lg px-4 py-2.5 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                      isPopular
                        ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
                        : 'bg-gray-900 hover:bg-gray-800 text-white'
                    }`}
                  >
                    {loadingTier === tier ? 'Loading…' : 'Get started'}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-100 py-8 px-6">
        <div className="max-w-4xl mx-auto flex flex-col items-center justify-between gap-3 sm:flex-row text-sm text-gray-400">
          <span>&copy; {new Date().getFullYear()} Tarhunna</span>
          <div className="flex items-center gap-5">
            <Link href="/"            className="hover:text-gray-700 transition-colors">Home</Link>
            <Link href="/pricing"     className="hover:text-gray-700 transition-colors">Pricing</Link>
            <Link href="/privacy"     className="hover:text-gray-700 transition-colors">Privacy</Link>
            <Link href="/terms"       className="hover:text-gray-700 transition-colors">Terms</Link>
            <Link href="/sms-consent" className="hover:text-gray-700 transition-colors">SMS Consent</Link>
            <Link href="/login"       className="hover:text-gray-700 transition-colors">Sign in</Link>
          </div>
        </div>
      </footer>

    </div>
  )
}
