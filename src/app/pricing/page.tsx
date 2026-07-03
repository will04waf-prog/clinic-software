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

// Per-tier feature lists shown in the pricing cards.
//
// Source of truth for tier capabilities is src/lib/billing/tiers.ts —
// every checkmark here must match a real flag in TIER_LIMITS (or a
// shipped capability the tier opens up). Voice agent + outbound
// reminders are Scale-only (allowsCallAgent). AI Twin SMS drafts /
// voice training / automations are Pro+ (allowsVoiceTraining,
// allowsAutomationSequences). The CRM, public booking page, two-way
// SMS, manual AI draft button, and AI lead summary are available to
// every tier including Starter.
const TIER_FEATURES: Record<TierId, string[]> = {
  starter: [
    'Up to 500 contacts, 2 seats',
    'Full CRM — contacts, kanban pipeline, consultations calendar, tags, notes, activity timeline',
    'Public booking page at /book/[slug] with real provider availability',
    'Signed /manage SMS links — patients reschedule and cancel themselves',
    'Two-way SMS threading on your own phone number',
    'AI lead summary on every contact',
    'Manual AI draft button on inbound texts (you review and send)',
    'Stripe-billed 14-day trial, switch tiers anytime',
  ],
  professional: [
    'Up to 2,500 contacts, 5 seats',
    'Everything in Starter',
    'AI Twin drafts every inbound SMS in your voice (owner approves each send)',
    'AI Twin draft includes real open booking slots from your live calendar',
    'AI Twin voice training — capture your real reply style',
    'AI Twin audit + flagging',
    'Automated 24h and 2h consultation reminder SMS',
    'Bulk CSV contact import',
  ],
  scale: [
    'Unlimited contacts, unlimited seats',
    'Everything in Professional',
    'Layla — AI voice receptionist that answers your phone 24/7 or after-hours',
    'Layla books, reschedules, cancels, transfers to a human, and takes messages live on the call',
    'Outbound AI reminder calls 4–72h before each visit (confirm / reschedule / cancel by voice)',
    'Voice messages inbox + full call logs with transcripts, dispositions, and recordings',
    'PHI-scrubbed post-call summary emails to the owner',
    'Autonomous AI Twin SMS send — replies 24/7 within your guardrails',
    'Direct founder support',
  ],
}

// Feature-matrix rows shown BELOW the three pricing cards. Honest
// copy — a row is either available on a tier or it isn't. We use a
// mint check for yes and a muted dash for no (no red Xs — we aren't
// punishing lower tiers). Every row must trace back to a real
// capability flag in src/lib/billing/tiers.ts or a shipped feature.
const FEATURE_MATRIX: { feature: string; starter: boolean; professional: boolean; scale: boolean }[] = [
  // CRM foundation — every tier
  { feature: 'CRM (contacts, pipeline, calendar, timeline)',    starter: true,  professional: true,  scale: true  },
  { feature: 'Public booking page + signed /manage links',      starter: true,  professional: true,  scale: true  },
  { feature: 'Two-way SMS threading on your own phone number',     starter: true,  professional: true,  scale: true  },
  { feature: 'AI lead summary on every contact',                starter: true,  professional: true,  scale: true  },
  { feature: 'Manual AI draft button',                          starter: true,  professional: true,  scale: true  },
  // Pro+ — AI Twin SMS + automations
  { feature: 'AI Twin drafts every inbound SMS in your voice',  starter: false, professional: true,  scale: true  },
  { feature: 'AI Twin voice training + voice health metrics',   starter: false, professional: true,  scale: true  },
  { feature: 'AI Twin audit + flag',                            starter: false, professional: true,  scale: true  },
  { feature: 'Automated 24h / 2h consultation reminders',       starter: false, professional: true,  scale: true  },
  { feature: 'Bulk CSV contact import',                         starter: false, professional: true,  scale: true  },
  // Scale-only — full Layla voice agent + autonomous SMS
  { feature: 'Layla — AI voice receptionist (inbound calls)',   starter: false, professional: false, scale: true  },
  { feature: 'Outbound AI reminder calls (4–72h before visit)', starter: false, professional: false, scale: true  },
  { feature: 'Voice messages inbox + call logs with transcripts', starter: false, professional: false, scale: true },
  { feature: 'Autonomous AI Twin SMS send',                     starter: false, professional: false, scale: true  },
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
              Three tiers. Voice unlocks at Scale.
            </h1>
            <p className="text-gray-600 text-base sm:text-lg max-w-2xl mx-auto">
              The CRM, booking page, and two-way SMS are on every plan.
              AI Twin SMS drafts unlock on Professional. Layla — the AI voice
              receptionist who answers your phone — is on Scale. 14-day free
              trial, switch tiers anytime, no per-seat surprise.
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
              The CRM is the foundation on every plan. AI Twin drafts your
              SMS replies on Professional. Layla — the voice receptionist who
              books appointments live on the call — unlocks on Scale.
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
                blurb="The CRM, a public booking page, signed reschedule links, two-way SMS on your own phone number, and a manual AI draft button you review before sending. 500 contacts, 2 seats."
              />
              <TierCallout
                id="professional"
                name="Professional"
                accent="#028090"
                blurb="AI Twin drafts every inbound SMS in your voice with real open slots in the body — you approve each send. Plus voice training, audit + flag, and 24h/2h consultation reminders. 2,500 contacts, 5 seats."
              />
              <TierCallout
                id="scale"
                name="Scale"
                accent="#02C39A"
                blurb="Layla, the AI voice receptionist, answers your phone and books appointments live on the call. Outbound AI reminder calls cut no-shows. Voice messages inbox + full call logs with transcripts. AI Twin SMS sends autonomously. Unlimited contacts and seats."
              />
            </div>
          </section>

          {/* ── Final CTA ──────────────────────────────────────────── */}
          <section className="mt-20 rounded-2xl bg-[#14241D] text-[#FAF6EC] px-6 py-12 sm:px-12 sm:py-14 text-center">
            <h2 className="text-2xl sm:text-3xl font-semibold mb-3">
              Let Layla answer your next call.
            </h2>
            <p className="mx-auto max-w-xl text-[15px] text-[#FAF6EC]/80 mb-7">
              Start the 14-day trial in under 20 minutes — or book a 20-minute
              demo and talk to the founder, not a sales rep.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => handleGetStarted('professional')}
                disabled={loadingTier !== null}
                className="inline-flex items-center justify-center rounded-lg bg-gradient-brand text-white px-5 py-2.5 text-sm font-medium hover:scale-[1.02] transition-all duration-150 disabled:opacity-50"
              >
                Start 14-day free trial
              </button>
              <Link
                href="/book-demo"
                className="inline-flex items-center justify-center rounded-lg border border-[#FAF6EC]/30 text-[#FAF6EC] px-5 py-2.5 text-sm font-medium hover:bg-[#FAF6EC]/10 transition-colors"
              >
                Book a 20-min demo
              </Link>
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
