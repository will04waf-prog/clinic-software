import type { Metadata } from 'next'
import { BookDemoForm } from './book-demo-form'
import { LogoMark } from '@/components/ui/logo-mark'

export const metadata: Metadata = {
  title: 'Book a Demo — Layla, the AI receptionist for clinics | Tarhunna',
  description:
    'See Layla answer a live call, book an appointment, and text the confirmation — then how the CRM, AI Twin SMS, and self-service booking fit underneath. 20 minutes with a founder, not a sales rep.',
  robots: { index: true, follow: true },
  alternates: { canonical: 'https://tarhunna.net/book-demo' },
}

// What the 20-minute demo actually covers. Each item maps to a shipped
// capability in the product; tier badge reflects where it unlocks so we
// don't oversell on the Starter plan.
const DEMO_AGENDA: Array<{
  title: string
  detail: string
  tier: 'starter' | 'professional' | 'scale'
}> = [
  {
    title: 'Layla answers a live call',
    detail:
      'We dial a real clinic line. Layla picks up, books an appointment from real availability, and texts the confirmation before we hang up.',
    tier: 'scale',
  },
  {
    title: 'Outbound reminder calls and the voice messages inbox',
    detail:
      'How Layla phones patients 4–72 hours ahead to confirm or reschedule, and where the messages she can’t resolve land for triage.',
    tier: 'scale',
  },
  {
    title: 'AI Twin SMS replies in your voice',
    detail:
      'Inbound texts come back with a drafted reply that already includes real open slots. Owner-approved on Professional, autonomous on Scale.',
    tier: 'professional',
  },
  {
    title: 'Self-service booking and reschedule links',
    detail:
      'Your public /book page and the signed /manage link patients tap to move their own visit — no front-desk round-trip.',
    tier: 'starter',
  },
  {
    title: 'The CRM underneath it all',
    detail:
      'Where every call, text, and booking lands: contacts, kanban pipeline, consultations calendar, activity timeline, tags, and notes.',
    tier: 'starter',
  },
  {
    title: 'Automation sequences for the rest of the funnel',
    detail:
      'Multi-step email + SMS sequences triggered by new lead, stage change, no-show, or reactivation — plus the standard 24h and 2h consultation reminders.',
    tier: 'professional',
  },
  {
    title: 'Tiers, pricing, and what you actually get',
    detail:
      'Honest walk-through of the ladder: Starter $147 (CRM), Professional $297 (CRM + AI Twin SMS + automations), Scale $497 (full Layla voice agent). Annual is 20% off.',
    tier: 'starter',
  },
]

const TIER_LABEL: Record<'starter' | 'professional' | 'scale', string> = {
  starter: 'Every plan',
  professional: 'Professional+',
  scale: 'Scale only',
}

export default function BookDemoPage() {
  return (
    <div className="min-h-screen bg-[#F5EFE1] flex flex-col">
      {/* Nav */}
      <header className="bg-white border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <a href="/" className="flex items-center gap-2">
            <LogoMark size="sm" standalone />
          </a>
          <a
            href="/login"
            className="text-sm text-gray-500 hover:text-gray-900 transition-colors"
          >
            Sign in
          </a>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 px-6 py-16">
        <div className="mx-auto grid w-full max-w-6xl gap-12 lg:grid-cols-[1.05fr_1fr] lg:items-start">
          {/* Left: hero + agenda */}
          <div>
            {/* Eyebrow */}
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#02C39A]/30 bg-white/70 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-brand-700">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-brand-500" />
              20-minute live walkthrough
            </div>

            <h1 className="text-4xl font-bold tracking-tight text-[#14241d] sm:text-5xl">
              Watch Layla answer a real call, book an appointment, and text the confirmation.
            </h1>

            <p className="mt-5 text-lg text-gray-600">
              An AI receptionist that answers every call, backed by a full CRM. Layla picks up the
              phone, books appointments, texts the link, and writes back to inbound SMS in your
              voice — so leads stop slipping while your front desk is on another call.
            </p>

            {/* Trust signals */}
            <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm text-gray-600">
              <span className="flex items-center gap-1.5">
                <svg className="h-4 w-4 text-brand-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Talk to a founder, not a sales rep
              </span>
              <span className="flex items-center gap-1.5">
                <svg className="h-4 w-4 text-brand-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Live product, not a slide deck
              </span>
              <span className="flex items-center gap-1.5">
                <svg className="h-4 w-4 text-brand-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                14-day trial waiting on the other side
              </span>
            </div>

            {/* Agenda */}
            <div className="mt-10">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-[#14241d]">
                What we&rsquo;ll cover
              </h2>
              <ul className="mt-4 space-y-4">
                {DEMO_AGENDA.map((item) => (
                  <li
                    key={item.title}
                    className="rounded-xl border border-gray-200 bg-white/70 p-4 shadow-sm"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-semibold text-[#14241d]">
                        {item.title}
                      </h3>
                      <span
                        className={
                          item.tier === 'scale'
                            ? 'inline-flex items-center rounded-full bg-[#14241d] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#F5EFE1]'
                            : item.tier === 'professional'
                            ? 'inline-flex items-center rounded-full border border-brand-600/30 bg-brand-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-700'
                            : 'inline-flex items-center rounded-full border border-gray-300 bg-[#F5EFE1] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-700'
                        }
                      >
                        {TIER_LABEL[item.tier]}
                      </span>
                    </div>
                    <p className="mt-1.5 text-sm leading-relaxed text-gray-600">{item.detail}</p>
                  </li>
                ))}
              </ul>
            </div>

            {/* Prefer-trial nudge */}
            <div className="mt-8 rounded-xl border border-dashed border-[#02C39A]/40 bg-white/60 p-4 text-sm text-gray-700">
              <span className="font-semibold text-[#14241d]">In a hurry?</span>{' '}
              <a href="/signup" className="text-brand-700 underline-offset-2 hover:underline">
                Start the 14-day free trial
              </a>{' '}
              and we&rsquo;ll book your demo from inside the product.
            </div>
          </div>

          {/* Right: form */}
          <div className="lg:sticky lg:top-24">
            <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
              <div className="mb-6">
                <h2 className="text-2xl font-bold text-[#14241d]">
                  Pick a time
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  20 minutes. We&rsquo;ll confirm by email and send a calendar invite.
                </p>
              </div>
              <BookDemoForm />
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="py-6 text-center text-sm text-gray-400">
        <a href="/" className="hover:text-gray-600 transition-colors">Tarhunna</a>
        {' · '}
        <a href="/med-spa-crm" className="hover:text-gray-600 transition-colors">Med Spa CRM</a>
        {' · '}
        <a href="/privacy" className="hover:text-gray-600 transition-colors">Privacy</a>
        {' · '}
        <a href="/terms" className="hover:text-gray-600 transition-colors">Terms</a>
        {' · '}
        <a href="/login" className="hover:text-gray-600 transition-colors">Sign in</a>
      </footer>
    </div>
  )
}
