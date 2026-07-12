import type { Metadata } from 'next'
import Link from 'next/link'
import {
  ArrowRight,
  BellRing,
  CalendarCheck,
  CheckCircle,
  Droplets,
  FileText,
  Hammer,
  Languages,
  MessageSquareText,
  PhoneCall,
  Smartphone,
  Sparkles,
  TreePine,
  UtensilsCrossed,
} from 'lucide-react'
import { SignatureLogo } from '@/components/ui/signature-logo'
import { LogoMark } from '@/components/ui/logo-mark'
import { AnimatedSection } from '@/components/marketing/animated-section'
import { AnimatedCard } from '@/components/marketing/animated-card'
import { SmoothScrollProvider } from '@/components/marketing/smooth-scroll-provider'
import { ParallaxGlow } from '@/components/marketing/parallax-glow'
import { MagneticCta } from '@/components/marketing/magnetic-cta'
import { HeroEcho } from '@/components/marketing/hero-echo'
import { AuroraDrift } from '@/components/marketing/aurora'
import { BilingualRoll } from '@/components/marketing/bilingual-roll'
import { LaylaDock } from '@/components/marketing/layla-dock'
import { DemoCallPill } from '@/components/marketing/demo-call-pill'

/**
 * /trades — English landing for trades / local-service owners
 * (landscaping, cleaning, construction, food) whose CUSTOMERS often
 * call in Spanish. Mirror of /es with the languages flipped.
 *
 * Intentionally UNLINKED from the rest of the site (pending founder
 * copy approval); reachable only by direct URL. Do not link from nav,
 * footer, or sitemap until approved.
 */

const TEL_HREF = 'tel:+18555894238'
const DEMO_NUMBER = '(855) 589-4238'

export const metadata: Metadata = {
  title: 'Layla — the bilingual AI receptionist for the trades',
  description:
    'Layla answers your existing business number 24/7 in English and Spanish, books the job on the call, texts the confirmation, and alerts you instantly when a call is urgent — a burst pipe, a water leak, a gas smell. Built for landscaping, cleaning, construction, and food businesses.',
  alternates: {
    canonical: 'https://tarhunna.net/trades',
  },
  openGraph: {
    type: 'website',
    siteName: 'Tarhunna',
    title: 'Layla — the bilingual AI receptionist for the trades',
    description:
      'She answers your number 24/7 in English and Spanish, books the job on the call, texts the confirmation, and alerts you the minute a call is urgent.',
    url: 'https://tarhunna.net/trades',
    locale: 'en_US',
  },
}

// ── What Layla does on every call — receptionist verbs ──
const VERBS = [
  {
    icon: PhoneCall,
    title: 'Answers',
    body: "Second ring, on the number your customers already have, with your business's name. At 1pm or at 11pm — she doesn't take lunch and she doesn't call in sick.",
  },
  {
    icon: Languages,
    title: 'Speaks both languages',
    body: 'She greets, listens, and answers in the language the caller uses. If they start in Spanish and switch to English mid-call — or the other way around — she follows, on the same call, no transfer.',
    bilingual: true,
  },
  {
    icon: CalendarCheck,
    title: 'Books the job',
    body: 'She asks what they need, where, and when — and locks the appointment in before they hang up. No more "let me check and call you back" that never happens.',
  },
  {
    icon: MessageSquareText,
    title: 'Texts the confirmation',
    body: 'The moment the call ends, the customer gets a text with the date and time. Fewer no-shows, fewer wasted trips.',
  },
  {
    icon: BellRing,
    title: 'Flags urgent calls',
    body: "Burst pipe, water leak, gas smell: she recognizes it on the spot and you get an instant alert with the caller's number and the problem. You decide — call back now, or roll the truck.",
  },
  {
    icon: FileText,
    title: 'Writes it all down',
    body: 'Every call lands in your dashboard with a full transcript. Nothing lives on a sticky note or in somebody’s memory.',
  },
] as const

// ── The urgent-call story — the differentiator ──
const URGENT_STEPS = [
  {
    icon: Droplets,
    time: '9:14 PM',
    title: 'The call comes in',
    body: "A customer calls in a panic — water pouring out from under the water heater. Your crew went home two hours ago. Layla picks up on the second ring.",
  },
  {
    icon: BellRing,
    time: '9:15 PM',
    title: 'Layla flags it urgent',
    body: 'She knows this is not a quote request. She gets the address, tells the caller the owner is being alerted right now, and takes down every detail.',
  },
  {
    icon: Smartphone,
    time: '9:15 PM',
    title: 'Your phone buzzes',
    body: "A text lands with the caller's number and the problem, in their own words. Call back or head over — either way, you know within the minute, not tomorrow morning.",
  },
] as const

// ── Who it's for ──
const SEGMENTS = [
  { icon: TreePine, label: 'Landscaping & lawn care' },
  { icon: Sparkles, label: 'Cleaning' },
  { icon: Hammer, label: 'Construction & trades' },
  { icon: UtensilsCrossed, label: 'Food & restaurants' },
] as const

export default function TradesLandingPage() {
  return (
    <SmoothScrollProvider>
      <div className="landing-page flex min-h-screen flex-col bg-[#F5EFE1]">

        {/* ── Minimal nav — no links into the rest of the site ── */}
        <header className="sticky top-0 z-50 border-b border-gray-100 bg-[#F5EFE1] pointer-fine:bg-[#F5EFE1]/90 pointer-fine:backdrop-blur-sm">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
            <div className="flex items-center" aria-label="Tarhunna">
              <LogoMark size="md" priority standalone />
            </div>
            <nav className="flex items-center gap-3">
              <a
                href={TEL_HREF}
                className="hidden sm:inline-flex items-center gap-1.5 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
              >
                <PhoneCall className="h-3.5 w-3.5" aria-hidden="true" />
                {DEMO_NUMBER}
              </a>
              <Link
                href="/book-demo"
                className="rounded-lg bg-gradient-brand px-4 py-2 text-sm font-semibold text-white hover:scale-[1.02] transition-all duration-150"
              >
                Book a founder demo
              </Link>
            </nav>
          </div>
        </header>

        <main className="flex-1">

          {/* ── Hero ─────────────────────────────────────────── */}
          <section className="relative overflow-hidden bg-[#F5EFE1] px-6 py-20 sm:py-28">
            <ParallaxGlow />
            <div className="relative z-10 mx-auto max-w-3xl text-center">
              <div className="rise mb-3 flex flex-col items-center gap-2" style={{ '--stagger': 0 } as React.CSSProperties}>
                <SignatureLogo size="xl" variant="light-bg" animated />
                <p className="text-xs font-semibold uppercase tracking-widest text-[#14241d]">
                  The bilingual AI receptionist for the trades.
                </p>
              </div>
              <h1 className="rise text-4xl font-extrabold leading-[1.08] tracking-tight text-gray-900 sm:text-5xl lg:text-6xl" style={{ '--stagger': 1 } as React.CSSProperties}>
                You&apos;re losing <HeroEcho className="whitespace-nowrap text-[#14241d]">1 in 4 calls</HeroEcho> right now.
              </h1>
              <p className="rise mt-5 text-lg text-gray-500 sm:text-xl max-w-2xl mx-auto" style={{ '--stagger': 2 } as React.CSSProperties}>
                And in your line of work, plenty of them come in Spanish — those never leave a
                voicemail. Layla answers your existing number 24/7 in English and Spanish, books
                the job on the call, and texts the confirmation. When a call is urgent — a burst
                pipe at 9pm — she doesn&apos;t take a message. She alerts you instantly.
              </p>
              <p className="rise mt-3 text-xs text-gray-400" style={{ '--stagger': 3 } as React.CSSProperties}>
                82% of callers who can&apos;t reach a business say they&apos;ll call a competitor next — CallRail consumer survey, 2025.
              </p>
              <div className="rise mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center" style={{ '--stagger': 4 } as React.CSSProperties}>
                <MagneticCta className="w-full sm:w-auto">
                  <Link
                    href="/book-demo"
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-brand px-6 py-3 text-base font-semibold text-white hover:scale-[1.02] transition-all duration-150 shadow-sm"
                  >
                    Book a 20-min demo
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </MagneticCta>
              </div>

              {/* Live demo line — the strongest proof on the page. Layla
                  answers this number for Rivera Landscaping, a fictional
                  landscaping company set up so prospects can hear her work. */}
              <a
                id="demo-line"
                href={TEL_HREF}
                style={{ '--stagger': 5 } as React.CSSProperties}
                className="rise group mx-auto mt-8 flex w-fit max-w-full items-center gap-3 rounded-2xl border border-brand-500/40 bg-brand-500/[0.07] px-5 py-3.5 transition-[background-color,border-color,transform] duration-150 hover:border-brand-500/70 hover:bg-brand-500/[0.12] active:scale-[0.98]"
              >
                <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-500/15">
                  <span className="phone-ping absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-500/30 [animation-duration:2.2s]" />
                  <PhoneCall className="phone-ring relative h-4 w-4 text-[#028090]" aria-hidden="true" />
                </span>
                <span className="text-left">
                  <span className="block text-[11px] font-semibold uppercase tracking-wider text-[#028090]">
                    Live demo — Layla picks up
                  </span>
                  <span className="block text-lg font-extrabold tracking-tight text-gray-900 sm:text-xl">
                    {DEMO_NUMBER}
                  </span>
                  <span className="block text-[12px] text-gray-500">
                    Call now. Start in English, switch to Spanish mid-sentence — she follows.
                  </span>
                </span>
              </a>
              <p className="rise mt-3 text-[11px] text-gray-400" style={{ '--stagger': 6 } as React.CSSProperties}>
                Layla answers as the receptionist for Rivera Landscaping, a fictional landscaping
                company we set up for the demo. The call is real; the company isn&apos;t.
              </p>

              <div className="rise mt-8 flex flex-col items-center gap-2 sm:flex-row sm:justify-center sm:gap-6" style={{ '--stagger': 7 } as React.CSSProperties}>
                {[
                  'Answers 24/7 — nights, weekends, holidays',
                  'English and Spanish on the same call',
                  'Demo with a founder, not a sales rep',
                ].map((item) => (
                  <div key={item} className="flex items-center gap-1.5 text-sm text-gray-500">
                    <CheckCircle className="h-4 w-4 text-brand-500 shrink-0" aria-hidden="true" />
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* ── Layla dock — her pipeline at a glance ────────── */}
          <div className="-mt-6 flex justify-center bg-[#F5EFE1] px-6 pb-2 sm:-mt-10">
            <LaylaDock />
          </div>

          {/* ── The urgent call — front and center ───────────── */}
          <section className="relative overflow-hidden bg-[#14241d] px-6 py-20">
            <AuroraDrift />
            <div className="relative z-10 mx-auto max-w-6xl">
              <AnimatedSection className="mb-12 text-center">
                <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-brand-500/30 bg-brand-500/10 px-3 py-1">
                  <BellRing className="h-3.5 w-3.5 text-[#02C39A]" aria-hidden="true" />
                  <span className="text-xs font-semibold uppercase tracking-wider text-[#F5EFE1]">
                    Urgent calls
                  </span>
                </div>
                <h2 className="text-3xl font-bold tracking-tight text-[#F5EFE1] sm:text-4xl">
                  A burst pipe at 9pm doesn&apos;t leave a voicemail.
                </h2>
                <p className="mt-3 text-[#F5EFE1]/70 max-w-2xl mx-auto">
                  It hangs up and dials the next name on the list. With Layla, your business
                  answers that call — and you know about it within the minute.
                </p>
              </AnimatedSection>
              <div className="grid gap-5 sm:grid-cols-3">
                {URGENT_STEPS.map(({ icon: Icon, time, title, body }, index) => (
                  <AnimatedCard
                    key={title}
                    index={index}
                    className="rounded-xl border border-brand-500/30 bg-[#F5EFE1] p-6 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-500/60 hover:shadow-md"
                  >
                    <div className="mb-4 flex items-center justify-between">
                      <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-brand-500/20">
                        <Icon className="h-5 w-5 text-[#14241d]" aria-hidden="true" />
                      </div>
                      <span className="text-xs font-bold uppercase tracking-wider text-[#028090]">{time}</span>
                    </div>
                    <h3 className="mb-2 text-base font-semibold text-gray-900">{title}</h3>
                    <p className="text-sm text-gray-600 leading-relaxed">{body}</p>
                  </AnimatedCard>
                ))}
              </div>
              {/* Channel honesty: SMS today, WhatsApp very soon. */}
              <AnimatedSection className="mt-8 flex justify-center">
                <p className="inline-flex flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-full border border-[#F5EFE1]/20 bg-[#F5EFE1]/5 px-5 py-2.5 text-center text-sm text-[#F5EFE1]/80">
                  <span className="font-semibold text-[#F5EFE1]">Owner alerts by text from day one.</span>
                  <span>WhatsApp alerts — coming very soon.</span>
                </p>
              </AnimatedSection>
            </div>
          </section>

          {/* ── What Layla does on every call ────────────────── */}
          <section className="bg-[#F5EFE1] px-6 py-20">
            <div className="mx-auto max-w-6xl">
              <AnimatedSection className="mb-12 text-center">
                <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-brand-500/40 bg-brand-500/10 px-3 py-1">
                  <PhoneCall className="h-3.5 w-3.5 text-[#14241d]" aria-hidden="true" />
                  <span className="text-xs font-semibold uppercase tracking-wider text-[#14241d]">
                    Layla · AI receptionist
                  </span>
                </div>
                <h2 className="text-3xl font-bold tracking-tight text-gray-900">
                  What Layla does on every call
                </h2>
                <p className="mt-3 text-gray-500 max-w-xl mx-auto">
                  Everything a good receptionist would do — except she&apos;s never on the other
                  line, never goes home, and speaks both languages.
                </p>
              </AnimatedSection>
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {VERBS.map(({ icon: Icon, title, body, ...rest }, index) => (
                  <AnimatedCard
                    key={title}
                    index={index}
                    className="flex flex-col rounded-2xl border border-gray-200 bg-[#FAF6EC] p-7 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
                  >
                    <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-brand-500/15">
                      <Icon className="h-5 w-5 text-[#026B78]" aria-hidden="true" />
                    </div>
                    <h3 className="text-xl font-semibold text-gray-900">{title}</h3>
                    <p className="mt-3 text-sm text-gray-600 leading-relaxed">{body}</p>
                    {'bilingual' in rest && <BilingualRoll layoutId="bilingual-roll-pill-trades" />}
                  </AnimatedCard>
                ))}
              </div>
            </div>
          </section>

          {/* ── The day's summary, in your language ──────────── */}
          <section className="bg-[#FAF6EC] bg-dot-grid px-6 py-20">
            <div className="mx-auto max-w-5xl">
              <AnimatedSection className="grid gap-10 lg:grid-cols-[1.1fr_1fr] lg:items-center">
                <div>
                  <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-brand-500/15">
                    <FileText className="h-6 w-6 text-[#026B78]" aria-hidden="true" />
                  </div>
                  <h2 className="text-3xl font-bold tracking-tight text-gray-900">
                    The caller spoke Spanish. You read it in English.
                  </h2>
                  <p className="mt-4 text-gray-500 leading-relaxed">
                    Every call lands in your dashboard with the full transcript: who called, what
                    they need, and what got booked. You read it in English or Spanish — whichever
                    you prefer — from your phone, at night or between jobs.
                  </p>
                  <p className="mt-3 text-gray-500 leading-relaxed">
                    No more guessing what happened on the phone while you were up on a ladder.
                  </p>
                </div>
                <ul className="space-y-3">
                  {[
                    'Every call from the day on one screen',
                    'Word-for-word transcript of each conversation',
                    'The jobs Layla booked, with date and time',
                    "Urgent calls flagged, with the caller's number",
                  ].map((line) => (
                    <li
                      key={line}
                      className="flex items-start gap-3 rounded-lg border border-gray-200 bg-[#F5EFE1] px-4 py-3"
                    >
                      <CheckCircle className="h-4 w-4 text-brand-500 mt-0.5 shrink-0" aria-hidden="true" />
                      <span className="text-sm text-gray-700 leading-snug">{line}</span>
                    </li>
                  ))}
                </ul>
              </AnimatedSection>
            </div>
          </section>

          {/* ── Who it's for ─────────────────────────────────── */}
          <section className="bg-[#F5EFE1] px-6 py-20">
            <div className="mx-auto max-w-5xl">
              <AnimatedSection className="mb-10 text-center">
                <h2 className="text-3xl font-bold tracking-tight text-gray-900">
                  Built for businesses that work with their hands
                </h2>
                <p className="mt-3 text-gray-500 max-w-2xl mx-auto">
                  If the phone rings while you&apos;re mowing, on a roof, or slammed in the
                  kitchen, Layla is the receptionist you&apos;ve never been able to hire.
                </p>
              </AnimatedSection>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {SEGMENTS.map(({ icon: Icon, label }, index) => (
                  <AnimatedCard
                    key={label}
                    index={index}
                    className="flex flex-col items-center gap-3 rounded-2xl border border-gray-200 bg-[#FAF6EC] px-4 py-6 text-center shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
                  >
                    <div className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-brand-500/15">
                      <Icon className="h-5 w-5 text-[#026B78]" aria-hidden="true" />
                    </div>
                    <span className="text-sm font-semibold text-gray-900">{label}</span>
                  </AnimatedCard>
                ))}
              </div>
            </div>
          </section>

          {/* ── Final CTA ────────────────────────────────────── */}
          <section id="final-cta" className="relative overflow-hidden bg-[#14241d] px-6 py-20">
            <AuroraDrift />
            <AnimatedSection className="relative z-10 mx-auto max-w-2xl text-center">
              <LogoMark size="lg" standalone className="mb-3" />
              <h2 className="text-3xl font-bold tracking-tight text-[#F5EFE1] sm:text-4xl">
                Let Layla answer your next call
              </h2>
              <p className="mt-4 text-[#F5EFE1]/70">
                In a 20-minute demo, a founder shows you how Layla would sound answering your
                business&apos;s phone — with your services and your hours. No pressure, no
                fine print.
              </p>
              <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
                <MagneticCta className="w-full sm:w-auto">
                  <Link
                    href="/book-demo"
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-brand px-6 py-3 text-base font-semibold text-white hover:scale-[1.02] transition-all duration-150 shadow-sm"
                  >
                    Book a founder demo
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </MagneticCta>
              </div>
              <a
                href={TEL_HREF}
                className="group mx-auto mt-6 flex w-fit max-w-full items-center gap-3 rounded-2xl border border-[#F5EFE1]/20 bg-[#F5EFE1]/5 px-5 py-3 transition-colors hover:border-brand-500/60 hover:bg-[#F5EFE1]/10"
              >
                <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-500/20">
                  <PhoneCall className="phone-ring-once phone-ring h-4 w-4 text-[#02C39A]" aria-hidden="true" />
                </span>
                <span className="text-left">
                  <span className="block text-[11px] font-semibold uppercase tracking-wider text-[#02C39A]">
                    Or just call her first
                  </span>
                  <span className="block text-lg font-extrabold tracking-tight text-[#F5EFE1]">
                    {DEMO_NUMBER}
                  </span>
                </span>
              </a>
            </AnimatedSection>
          </section>

        </main>

        {/* ── Footer ─────────────────────────────────────────── */}
        <footer className="border-t border-gray-200 bg-[#F5EFE1] px-6 py-8">
          <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 sm:flex-row">
            <div className="flex items-center gap-2.5">
              <LogoMark size="sm" standalone />
              <span className="text-sm text-gray-400">· The bilingual AI receptionist for the trades</span>
            </div>
            <div className="flex items-center gap-5 text-sm text-gray-500">
              <Link href="/privacy" className="hover:text-gray-900 transition-colors">Privacy</Link>
              <Link href="/terms" className="hover:text-gray-900 transition-colors">Terms</Link>
              <span>© {new Date().getFullYear()} Tarhunna</span>
            </div>
          </div>
        </footer>

        <DemoCallPill
          telHref={TEL_HREF}
          number={DEMO_NUMBER}
          eyebrow="Layla is live"
          mobileNote="— Layla answers"
          callLabel={`Call the live demo line, ${DEMO_NUMBER} — Layla answers`}
          dismissLabel="Dismiss the demo-line reminder"
          storageKey="tarhunna-trades-call-pill-dismissed"
        />

      </div>
    </SmoothScrollProvider>
  )
}
