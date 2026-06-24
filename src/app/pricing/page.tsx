'use client'

import Link from 'next/link'
import { useState } from 'react'
import { LogoMark } from '@/components/ui/logo-mark'
import { createClient } from '@/lib/supabase/client'
import { AnimatedCard } from '@/components/marketing/animated-card'
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
    'Manual AI draft button (review every reply)',
    'Persistent drafts in inbox',
    'Email support',
  ],
  professional: [
    'Up to 2,500 contacts',
    'Everything in Starter',
    'Voice training — capture your real reply style',
    'Voice health metrics',
    'AI Twin audit + flagging',
    'Automated email sequences',
    'Automated 24h/2h consultation reminders',
    'Bulk contact import',
    'Priority email support',
  ],
  scale: [
    'Unlimited contacts',
    'Everything in Professional',
    'Autonomous send — AI replies 24/7 within your guardrails',
    'Rollout dial + shadow mode',
    'Provider briefing every 24 hours',
    'Quiet hours (gates autonomous send)',
    'Direct founder support',
    'Dedicated onboarding session',
  ],
}

// Feature-matrix rows shown BELOW the three pricing cards. Honest
// copy — a row is either available on a tier or it isn't. We use a
// mint check for yes and a muted dash for no (no red Xs — we aren't
// punishing lower tiers).
const FEATURE_MATRIX: { feature: string; starter: boolean; professional: boolean; scale: boolean }[] = [
  { feature: 'Manual AI Draft button',                          starter: true,  professional: true,  scale: true  },
  { feature: 'Persistent drafts in inbox',                      starter: true,  professional: true,  scale: true  },
  { feature: 'Quiet hours (gates autonomous send)',             starter: false, professional: false, scale: true  },
  { feature: 'Voice training (capture your reply style)',       starter: false, professional: true,  scale: true  },
  { feature: 'Voice health metrics',                            starter: false, professional: true,  scale: true  },
  { feature: 'AI Twin audit + flag',                            starter: false, professional: true,  scale: true  },
  { feature: 'Autonomous send (AI replies without you)',        starter: false, professional: false, scale: true  },
  { feature: 'Rollout dial + shadow mode',                      starter: false, professional: false, scale: true  },
  { feature: 'Provider briefing every 24h',                     starter: false, professional: false, scale: true  },
]

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
    <div className="min-h-screen bg-[#F5EFE1] flex flex-col">

      {/* Nav */}
      <header className="border-b border-gray-100">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <LogoMark size="sm" standalone />
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
            {TIERS.map((tier, index) => {
              const isPopular      = tier === 'professional'
              const name           = TIER_DISPLAY_NAMES[tier]
              const features       = TIER_FEATURES[tier]
              const monthlyDollars = formatDollars(TIER_PRICING[tier].monthlyCents)
              const annualDollars  = formatDollars(TIER_ANNUAL_TOTAL_CENTS[tier])

              return (
                <AnimatedCard
                  key={tier}
                  index={index}
                  className={`relative flex flex-col rounded-2xl border bg-white p-7 ${
                    isPopular
                      ? 'border-[#02C39A]/40 shadow-lg ring-1 ring-[#02C39A]/20 md:-translate-y-2 hover:shadow-xl transition-shadow duration-200'
                      : 'border-gray-200 shadow-sm hover:-translate-y-0.5 hover:shadow-md transition-all duration-200'
                  }`}
                >
                  {isPopular && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <span className="inline-flex items-center rounded-full bg-gradient-brand text-white px-3 py-1 text-xs font-medium">
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
                        <span className="inline-flex items-center rounded-full bg-brand-100 text-brand-800 px-2.5 py-0.5 text-xs font-medium">
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
                    className={`mt-8 w-full rounded-lg px-4 py-2.5 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed ${
                      isPopular
                        ? 'bg-gradient-brand text-white hover:scale-[1.02] transition-all duration-150'
                        : 'bg-gray-900 hover:bg-gray-800 text-white transition-colors'
                    }`}
                  >
                    {loadingTier === tier ? 'Loading…' : 'Get started'}
                  </button>
                </AnimatedCard>
              )
            })}
          </div>

          {/* ── Feature matrix ─────────────────────────────────────── */}
          <section className="mt-20">
            <p className="mx-auto max-w-2xl text-center text-[14px] text-gray-700 mb-6">
              AI Twin is included on every plan. What changes is how much of
              your voice it learns and whether it can send for you.
            </p>
            <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-[#14241D] text-[#FAF6EC]">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold">Feature</th>
                    <th className="px-4 py-3 text-center font-semibold">Starter</th>
                    <th className="px-4 py-3 text-center font-semibold border-b-2 border-[#028090]">
                      Professional
                    </th>
                    <th className="px-4 py-3 text-center font-semibold border-b-2 border-[#02C39A]">
                      Scale
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {FEATURE_MATRIX.map((row, idx) => (
                    <tr key={row.feature} className={idx % 2 === 0 ? 'bg-white' : 'bg-[#FAF6EC]/40'}>
                      <td className="px-4 py-3 text-gray-800">{row.feature}</td>
                      <td className="px-4 py-3 text-center"><MatrixCell on={row.starter} /></td>
                      <td className="px-4 py-3 text-center"><MatrixCell on={row.professional} /></td>
                      <td className="px-4 py-3 text-center"><MatrixCell on={row.scale} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Anchor callouts — UpgradeCardLocked deep-links to
                #professional and #scale, so each tier needs an anchor
                target near the matrix. Informational only. */}
            <div className="mt-10 grid gap-4 md:grid-cols-3">
              <TierCallout
                id="starter"
                name="Starter"
                accent="#6B7572"
                blurb="AI drafts for every inbound — you review and send. Quiet hours and persistent drafts included."
              />
              <TierCallout
                id="professional"
                name="Professional"
                accent="#028090"
                blurb="Train the AI on your voice with example messages and tone sliders. See voice health metrics. Audit and flag every AI action."
              />
              <TierCallout
                id="scale"
                name="Scale"
                accent="#02C39A"
                blurb="The AI Twin replies on its own within your guardrails. Rollout dial, shadow mode, and a 24-hour briefing that explains what it handled."
              />
            </div>
          </section>
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

function MatrixCell({ on }: { on: boolean }) {
  if (on) {
    return (
      <span
        aria-label="included"
        className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#02C39A] text-white"
      >
        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </span>
    )
  }
  return (
    <span aria-label="not included" className="inline-block h-0.5 w-3 rounded bg-[#6B7572]/60" />
  )
}

interface TierCalloutProps {
  id: string
  name: string
  accent: string
  blurb: string
}

function TierCallout({ id, name, accent, blurb }: TierCalloutProps) {
  return (
    <div
      id={id}
      className="rounded-xl border bg-white p-5 scroll-mt-20"
      style={{ borderColor: `${accent}40` }}
    >
      <div className="flex items-center gap-2">
        <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: accent }} />
        <h4 className="text-base font-semibold text-gray-900">{name}</h4>
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-gray-600">{blurb}</p>
    </div>
  )
}
