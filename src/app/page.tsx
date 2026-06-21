import type { Metadata } from 'next'
import Link from 'next/link'
import {
  Users,
  CalendarDays,
  Zap,
  Mail,
  LayoutGrid,
  BellOff,
  CheckCircle,
  ArrowRight,
  AlertCircle,
  ChevronDown,
} from 'lucide-react'
import { HomeProductShowcase } from './home-product-showcase'
import { SignatureLogo } from '@/components/ui/signature-logo'
import { AnimatedSection } from '@/components/marketing/animated-section'
import { AnimatedCard } from '@/components/marketing/animated-card'
import { SmoothScrollProvider } from '@/components/marketing/smooth-scroll-provider'
import { ParallaxGlow } from '@/components/marketing/parallax-glow'

export const metadata: Metadata = {
  title: 'Tarhunna — CRM for Med Spas and Aesthetic Clinics',
  description:
    'CRM software for med spas, aesthetic clinics, and plastic surgery practices. Capture leads, automate follow-up, and reduce no-shows — all in one platform.',
  alternates: {
    canonical: 'https://tarhunna.net',
  },
  openGraph: {
    type: 'website',
    siteName: 'Tarhunna',
    title: 'Tarhunna — CRM for Med Spas and Aesthetic Clinics',
    description:
      'Stop losing leads between inquiries and consultations. Tarhunna helps aesthetic clinics capture, follow up, and convert more patients.',
    url: 'https://tarhunna.net',
    locale: 'en_US',
  },
}

// ── Page data ─────────────────────────────────────────────

const PAIN_POINTS = [
  'Leads arrive from Instagram, your website, and referrals with no central place to manage them',
  'Follow-up relies on memory or sticky notes instead of a consistent automated system',
  'No-shows happen because appointment reminders are manual, skipped, or too late',
]

const FEATURES = [
  {
    icon: Users,
    title: 'Lead Capture Forms',
    body: 'Embed a branded intake form on your website. Every inquiry lands directly in your CRM — no manual entry.',
  },
  {
    icon: LayoutGrid,
    title: 'Leads & Pipeline',
    body: 'See every lead at a glance. Move contacts through your pipeline from first inquiry to booked consultation.',
  },
  {
    icon: CalendarDays,
    title: 'Consultation Scheduling',
    body: 'Book, track, and manage consultations. See exactly who is coming in, what they want, and when.',
  },
  {
    icon: Zap,
    title: 'Automated Follow-Up',
    body: 'Set up follow-up sequences that trigger automatically. Nurture leads without lifting a finger.',
  },
  {
    icon: Mail,
    title: 'Manual Email',
    body: 'Send a personal email to any contact directly from Tarhunna. Tracked and logged to their profile.',
  },
  {
    icon: BellOff,
    title: 'No-Show Reduction',
    body: 'Automated reminders go out before every consultation so fewer patients forget and more show up.',
  },
]

const STEPS = [
  {
    number: '01',
    title: 'Capture the inquiry',
    body: 'A patient fills out your intake form. Their info lands in Tarhunna instantly — no manual logging.',
  },
  {
    number: '02',
    title: 'Organize the lead',
    body: 'Tag their procedure interest, move them into your pipeline, and assign to a team member.',
  },
  {
    number: '03',
    title: 'Follow up automatically',
    body: 'Sequences handle the nurture. Emails go out on schedule without you having to think about it.',
  },
  {
    number: '04',
    title: 'Book the consultation',
    body: 'Log the consultation, send a reminder, and show up ready. No-shows drop. Revenue grows.',
  },
]

const CLINIC_TYPES = [
  {
    label: 'Med Spas',
    description:
      'Botox, fillers, laser, and wellness — manage every inquiry, track every lead, and convert more bookings.',
    href: '/med-spa-crm',
  },
  {
    label: 'Aesthetic Clinics',
    description:
      'From first inquiry to loyal patient. Keep your pipeline full and your follow-up consistent across every channel.',
  },
  {
    label: 'Plastic Surgery Practices',
    description:
      'Long consideration cycles need smart follow-up. Tarhunna keeps leads warm until the patient is ready to book.',
  },
] as const

const COMPARISONS = [
  {
    heading: 'vs. Spreadsheets and sticky notes',
    tagline: 'The default — and the most expensive.',
    before:  'Miss one follow-up, the lead goes cold. Nobody notices until you wonder why bookings dropped.',
    after:   'Every inquiry captured automatically. Every follow-up scheduled. Every consultation tracked. Nothing slips.',
  },
  {
    heading: 'vs. Generic CRMs',
    tagline: 'Built for B2B sales reps. Retrofitted, awkwardly, for clinics.',
    before:  'Generic "deals" and "leads" that don\'t match how aesthetic clinics actually work. Weeks of customization and you\'re still not happy.',
    after:   'Built around aesthetic-clinic workflows from day one. Procedure-based intake, consultation tracking, no setup gymnastics.',
  },
  {
    heading: 'vs. Full-stack practice management platforms',
    tagline: 'Built to replace your entire stack — often with steep onboarding fees.',
    before:  'Replatform your whole clinic to get one new tool. Pay onboarding fees. Learn five new things.',
    after:   'Sits alongside your existing EMR. No replacement. No onboarding fee. Just better lead-to-consult conversion.',
  },
] as const

const FAQ_ITEMS = [
  {
    q: 'What is Tarhunna?',
    a: 'Tarhunna is a CRM and follow-up platform built for med spas, aesthetic clinics, and plastic surgery practices. It helps you capture leads, organize your pipeline, automate follow-up emails, and manage consultations — all in one place.',
  },
  {
    q: 'Who is Tarhunna for?',
    a: 'Tarhunna is built for aesthetic practices of all sizes — solo injectors, med spas, aesthetic clinics, and plastic surgery offices. If you are managing patient inquiries and consultations, Tarhunna is designed for you.',
  },
  {
    q: 'How does automated follow-up work?',
    a: 'You set up follow-up sequences tied to specific triggers — new lead, consultation booked, no-show — and Tarhunna sends emails automatically on your schedule. No manual work required once a sequence is running.',
  },
  {
    q: 'Does Tarhunna replace my EMR?',
    a: 'No. Tarhunna is a CRM and lead management tool, not an electronic medical records system. It handles the front-of-funnel — lead capture, follow-up, and consultation scheduling — and sits alongside your existing EMR.',
  },
  {
    q: 'How long does it take to get started?',
    a: 'Most clinics are fully set up in under 10 minutes. Add your services, share your intake form link, and your first leads start coming in right away. No technical setup required.',
  },
]

// ── Page ──────────────────────────────────────────────────

export default function LandingPage() {
  return (
    <SmoothScrollProvider>
    <div className="flex min-h-screen flex-col bg-[#F5EFE1]">

      {/* Organization schema — helps Google's knowledge graph recognize the brand */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'Organization',
            name: 'Tarhunna',
            url: 'https://tarhunna.net',
            logo: 'https://tarhunna.net/icon.svg',
            description: 'CRM software for med spas, aesthetic clinics, and plastic surgery practices.',
            foundingDate: '2024',
            contactPoint: {
              '@type': 'ContactPoint',
              contactType: 'customer support',
              url: 'https://tarhunna.net/signup',
            },
          }),
        }}
      />

      {/* WebSite schema — enables sitelinks search and brand recognition */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'WebSite',
            name: 'Tarhunna',
            url: 'https://tarhunna.net',
            description: 'CRM for med spas and aesthetic clinics',
            publisher: {
              '@type': 'Organization',
              name: 'Tarhunna',
            },
          }),
        }}
      />

      {/* SoftwareApplication schema — categorizes what the product is */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'SoftwareApplication',
            name: 'Tarhunna',
            applicationCategory: 'BusinessApplication',
            applicationSubCategory: 'CRM',
            operatingSystem: 'Web',
            url: 'https://tarhunna.net',
            description: 'CRM and follow-up platform for med spas, aesthetic clinics, and plastic surgery practices.',
            offers: {
              '@type': 'Offer',
              price: '0',
              priceCurrency: 'USD',
              description: '14-day free trial, no credit card required',
            },
          }),
        }}
      />

      {/* FAQPage schema — enables FAQ rich results in Google search */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'FAQPage',
            mainEntity: FAQ_ITEMS.map(({ q, a }) => ({
              '@type': 'Question',
              name: q,
              acceptedAnswer: { '@type': 'Answer', text: a },
            })),
          }),
        }}
      />

      {/* ── Nav ──────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 border-b border-gray-100 bg-[#F5EFE1] pointer-fine:bg-[#F5EFE1]/90 pointer-fine:backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <Link href="/" className="flex items-center gap-2.5">
            <SignatureLogo size="md" variant="light-bg" animated />
          </Link>
          <nav className="flex items-center gap-3">
            <Link
              href="/med-spa-crm"
              className="hidden sm:inline-block text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
            >
              For Med Spas
            </Link>
            <Link
              href="/pricing"
              className="text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
            >
              Pricing
            </Link>
            <Link
              href="/login"
              className="text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
            >
              Log in
            </Link>
            <Link
              href="/signup"
              className="rounded-lg bg-gradient-brand px-4 py-2 text-sm font-semibold text-white hover:scale-[1.02] transition-all duration-150"
            >
              Start free trial
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">

        {/* ── Hero ─────────────────────────────────────────────── */}
        <section className="relative overflow-hidden bg-[#F5EFE1] px-6 py-20 sm:py-28">
          <ParallaxGlow />
          <div className="relative z-10 mx-auto max-w-3xl text-center">
            <div className="mb-3 flex flex-col items-center gap-2">
              <SignatureLogo size="xl" variant="light-bg" animated />
              <p className="text-xs font-semibold uppercase tracking-widest text-[#14241d]">
                Every Lead. Every Time.
              </p>
            </div>
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-[#02C39A]/40 bg-[#02C39A]/15 px-4 py-1.5">
              <span className="text-xs font-semibold uppercase tracking-wider text-[#14241d]">
                14-day free trial · No credit card
              </span>
            </div>
            <h1 className="text-4xl font-extrabold leading-[1.08] tracking-tight text-gray-900 sm:text-5xl lg:text-6xl">
              Stop losing leads.<br className="hidden sm:block" /> Start booking <span className="text-[#14241d]">more consultations</span>.
            </h1>
            <p className="mt-5 text-lg text-gray-500 sm:text-xl max-w-2xl mx-auto">
              Purpose-built for aesthetic clinics — not a generic CRM retrofitted for
              healthcare. Capture every inquiry, follow up automatically, and convert more
              leads into booked consultations.
            </p>
            <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <Link
                href="/signup"
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-brand px-6 py-3 text-base font-semibold text-white hover:scale-[1.02] transition-all duration-150 shadow-sm"
              >
                Start free trial
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/login"
                className="w-full sm:w-auto inline-flex items-center justify-center rounded-lg border border-gray-200 bg-[#F5EFE1] px-6 py-3 text-base font-semibold text-gray-700 hover:border-gray-300 hover:text-gray-900 transition-colors"
              >
                Log in
              </Link>
            </div>
            <div className="mt-8 flex flex-col items-center gap-2 sm:flex-row sm:justify-center sm:gap-6">
              {['No credit card required', 'Setup in under 5 minutes', 'Cancel anytime'].map((item) => (
                <div key={item} className="flex items-center gap-1.5 text-sm text-gray-500">
                  <CheckCircle className="h-4 w-4 text-[#02C39A] shrink-0" />
                  {item}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Brand divider ────────────────────────────────────── */}
        <div className="mx-auto max-w-6xl px-6">
          <div className="divider-brand" role="presentation" aria-hidden="true" />
        </div>

        {/* ── Value pillars strip ──────────────────────────────── */}
        <section className="bg-[#F5EFE1] px-6 pt-10">
          <AnimatedSection className="mx-auto max-w-5xl">
            <div className="grid gap-px overflow-hidden rounded-2xl border border-gray-200 bg-gray-200 shadow-sm sm:grid-cols-3">
              {[
                { stat: 'Purpose-built', label: 'For aesthetic clinics — not a retrofitted sales CRM' },
                { stat: 'Under 10 min', label: 'From sign-up to your first lead captured' },
                { stat: 'Founder-led', label: 'Talk to a founder, never a sales rep' },
              ].map(({ stat, label }) => (
                <div key={stat} className="bg-[#F5EFE1] px-6 py-6 text-center">
                  <div className="text-xl font-extrabold tracking-tight text-[#14241d]">{stat}</div>
                  <p className="mt-1 text-sm text-gray-500 leading-relaxed">{label}</p>
                </div>
              ))}
            </div>
          </AnimatedSection>
        </section>

        {/* ── Product Showcase ─────────────────────────────────── */}
        <HomeProductShowcase />

        {/* ── Problem ──────────────────────────────────────────── */}
        <section className="bg-[#F5EFE1] px-6 py-20">
          <AnimatedSection className="mx-auto max-w-3xl">
            <div className="mb-10 text-center">
              <h2 className="text-3xl font-bold tracking-tight text-gray-900">
                Most clinic leads go cold before they ever book
              </h2>
              <p className="mt-4 text-gray-500 max-w-xl mx-auto">
                Aesthetic practices attract plenty of interest — but without a proper system,
                most of that interest quietly disappears. Leads arrive and then go quiet.
                Consultations get missed. Revenue walks out the door.
              </p>
            </div>
            <ul className="space-y-4 max-w-xl mx-auto">
              {PAIN_POINTS.map((point) => (
                <li key={point} className="flex items-start gap-3 rounded-lg border border-red-200 border-l-4 border-l-red-400 bg-red-50 px-5 py-4 shadow-sm">
                  <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                  <span className="text-sm text-gray-700">{point}</span>
                </li>
              ))}
            </ul>
            <p className="mt-8 text-center text-sm font-medium text-gray-700">
              Tarhunna fixes all three — in one platform built specifically for aesthetic clinics.
            </p>
          </AnimatedSection>
        </section>

        {/* ── Built differently ────────────────────────────────── */}
        <section className="bg-dot-grid bg-[#F5EFE1] px-6 py-20">
          <div className="mx-auto max-w-6xl">
            <AnimatedSection className="mb-12 text-center">
              <h2 className="text-3xl font-bold tracking-tight text-gray-900">
                Built differently from the alternatives
              </h2>
              <p className="mt-3 text-gray-500 max-w-xl mx-auto">
                Most clinic owners try one of three options before finding Tarhunna.
                Each one fails in a specific way.
              </p>
            </AnimatedSection>
            <div className="grid gap-5 sm:grid-cols-3">
              {COMPARISONS.map(({ heading, tagline, before, after }, index) => (
                <AnimatedCard key={heading} index={index} className="rounded-xl border border-gray-200 bg-[#F5EFE1] p-6 shadow-sm flex flex-col gap-4 hover:-translate-y-0.5 hover:shadow-md transition-all duration-200">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">{heading}</h3>
                    <p className="mt-2 text-sm italic text-gray-500 leading-relaxed">{tagline}</p>
                  </div>
                  <div className="rounded-lg bg-red-50 border border-red-100 px-4 py-3">
                    <p className="text-xs font-semibold text-red-400 uppercase tracking-wide mb-1">Without Tarhunna</p>
                    <p className="text-sm text-gray-600 leading-relaxed">{before}</p>
                  </div>
                  <div className="rounded-lg bg-[#02C39A]/15 border border-[#02C39A]/30 px-4 py-3">
                    <p className="text-xs font-semibold text-[#14241d] uppercase tracking-wide mb-1">With Tarhunna</p>
                    <p className="text-sm text-gray-600 leading-relaxed">{after}</p>
                  </div>
                </AnimatedCard>
              ))}
            </div>
          </div>
        </section>

        {/* ── Features ─────────────────────────────────────────── */}
        <section className="bg-[#14241d] px-6 py-20">
          <div className="mx-auto max-w-6xl">
            <AnimatedSection className="mb-12 text-center">
              <h2 className="text-3xl font-bold tracking-tight text-[#F5EFE1]">
                CRM tools built for med spas and aesthetic practices
              </h2>
              <p className="mt-3 text-[#F5EFE1]/70 max-w-xl mx-auto">
                Not a generic CRM retrofitted for healthcare. Every feature is designed around
                how aesthetic clinics actually work.
              </p>
            </AnimatedSection>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(({ icon: Icon, title, body }, index) => (
                <AnimatedCard key={title} index={index} className="rounded-xl border border-[#02C39A]/30 bg-[#F5EFE1] p-6 shadow-sm hover:-translate-y-0.5 hover:shadow-md transition-all duration-200 hover:border-[#02C39A]/60">
                  <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[#02C39A]/20">
                    <Icon className="h-5 w-5 text-[#14241d]" />
                  </div>
                  <h3 className="mb-2 text-base font-semibold text-gray-900">{title}</h3>
                  <p className="text-sm text-gray-600 leading-relaxed">{body}</p>
                </AnimatedCard>
              ))}
            </div>
          </div>
        </section>

        {/* ── How it works ─────────────────────────────────────── */}
        <section className="bg-[#F5EFE1] px-6 py-20">
          <div className="mx-auto max-w-4xl">
            <AnimatedSection className="mb-12 text-center">
              <h2 className="text-3xl font-bold tracking-tight text-gray-900">
                From first inquiry to booked consultation
              </h2>
              <p className="mt-3 text-gray-500">
                Four steps — automated, organized, and built into one simple workflow.
              </p>
            </AnimatedSection>
            <div className="relative">
              {/* Connecting flow line behind the steps (desktop only) */}
              <div
                className="pointer-events-none absolute left-0 right-0 top-6 hidden lg:block"
                aria-hidden="true"
              >
                <div className="mx-auto h-px w-3/4 bg-gradient-to-r from-transparent via-[#02C39A]/40 to-transparent" />
              </div>
              <div className="relative grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
                {STEPS.map(({ number, title, body }, index) => (
                  <AnimatedCard key={number} index={index} className="group text-center sm:text-left">
                    <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full border border-[#02C39A]/30 bg-[#F5EFE1] text-lg font-black text-[#14241d] shadow-sm transition-all duration-200 group-hover:border-[#02C39A] group-hover:shadow-md">
                      {number}
                    </div>
                    <h3 className="mb-2 text-base font-semibold text-gray-900">{title}</h3>
                    <p className="text-sm text-gray-500 leading-relaxed">{body}</p>
                  </AnimatedCard>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── Who it's for ─────────────────────────────────────── */}
        <section className="bg-[#F5EFE1] px-6 py-20">
          <div className="mx-auto max-w-5xl">
            <AnimatedSection className="mb-12 text-center">
              <h2 className="text-3xl font-bold tracking-tight text-gray-900">
                Built for med spas, aesthetic clinics, and plastic surgery practices
              </h2>
              <p className="mt-3 text-gray-500">
                Whether you are a solo injector or a multi-provider practice, Tarhunna fits your workflow.
              </p>
            </AnimatedSection>
            <div className="grid gap-5 sm:grid-cols-3">
              {CLINIC_TYPES.map((type, index) => {
                const { label, description } = type
                const href = 'href' in type ? type.href : undefined
                const content = (
                  <>
                    <div className="mb-3 inline-flex rounded-full bg-[#02C39A]/15 px-3 py-1">
                      <span className="text-sm font-semibold text-[#14241d]">{label}</span>
                    </div>
                    <p className="text-sm text-gray-500 leading-relaxed">{description}</p>
                    {href && (
                      <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-[#14241d] group-hover:gap-1.5 transition-all">
                        Learn more
                        <ArrowRight className="h-3.5 w-3.5" />
                      </span>
                    )}
                  </>
                )
                return href ? (
                  <AnimatedCard key={label} index={index}>
                    <Link
                      href={href}
                      className="group block rounded-xl border border-gray-200 bg-[#F5EFE1] p-6 shadow-sm hover:border-[#02C39A]/40 hover:-translate-y-0.5 hover:shadow-md transition-all duration-200"
                    >
                      {content}
                    </Link>
                  </AnimatedCard>
                ) : (
                  <AnimatedCard key={label} index={index} className="rounded-xl border border-gray-200 bg-[#F5EFE1] p-6 shadow-sm hover:-translate-y-0.5 hover:shadow-md transition-all duration-200">
                    {content}
                  </AnimatedCard>
                )
              })}
            </div>
          </div>
        </section>

        {/* ── Med Spa callout ──────────────────────────────────── */}
        <section className="bg-[#F5EFE1] px-6 pb-2">
          <AnimatedSection className="mx-auto max-w-5xl">
            <Link
              href="/med-spa-crm"
              className="group flex items-center justify-between gap-4 rounded-xl border border-[#02C39A]/40 bg-[#02C39A]/15 px-6 py-4 hover:border-[#02C39A]/70 hover:bg-[#02C39A]/25 transition-colors"
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-sm font-semibold text-[#14241d]">Running a med spa?</span>
                <span className="text-sm text-gray-600">
                  See how Tarhunna helps med spas capture leads and book more consultations.
                </span>
              </div>
              <ArrowRight className="h-4 w-4 shrink-0 text-[#14241d] transition-transform group-hover:translate-x-0.5" />
            </Link>
          </AnimatedSection>
        </section>

        {/* ── FAQ ──────────────────────────────────────────────── */}
        <section className="bg-[#F5EFE1] px-6 py-20">
          <AnimatedSection className="mx-auto max-w-3xl">
            <div className="mb-12 text-center">
              <h2 className="text-3xl font-bold tracking-tight text-gray-900">
                Frequently asked questions
              </h2>
            </div>
            <div className="space-y-0 divide-y divide-gray-200 rounded-xl border border-gray-200 bg-[#F5EFE1] overflow-hidden shadow-sm">
              {FAQ_ITEMS.map(({ q, a }) => (
                <details key={q} className="group px-6 [&_summary::-webkit-details-marker]:hidden">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-sm font-semibold text-gray-900 transition-colors hover:text-[#14241d]">
                    {q}
                    <ChevronDown className="h-4 w-4 shrink-0 text-gray-400 transition-transform duration-200 group-open:rotate-180" />
                  </summary>
                  <p className="pb-5 text-sm text-gray-500 leading-relaxed">{a}</p>
                </details>
              ))}
            </div>
          </AnimatedSection>
        </section>

        {/* ── Founder-led ──────────────────────────────────────── */}
        <section className="bg-[#F5EFE1] px-6 py-16">
          <AnimatedSection className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-bold tracking-tight text-gray-900">
              Built by people who care about your clinic
            </h2>
            <p className="mt-4 text-gray-500 leading-relaxed">
              Tarhunna isn&apos;t backed by venture capital or built by an enterprise software
              team. It&apos;s built by two founders in Frederick, Maryland who saw clinics
              losing thousands of dollars a month in leads that just disappeared.
            </p>
            <p className="mt-4 text-gray-500 leading-relaxed">
              Want to talk about your clinic? Book a demo — you&apos;ll talk to a founder, not a
              sales rep.
            </p>
            <div className="mt-8">
              <Link
                href="/book-demo"
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-brand px-6 py-3 text-base font-semibold text-white hover:scale-[1.02] transition-all duration-150 shadow-sm"
              >
                Book a demo
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </AnimatedSection>
        </section>

        {/* ── Final CTA ────────────────────────────────────────── */}
        <section className="bg-[#14241d] px-6 py-20">
          <AnimatedSection className="mx-auto max-w-2xl text-center">
            <SignatureLogo size="lg" variant="dark-bg" animated className="mb-3 block" />
            <h2 className="text-3xl font-bold tracking-tight text-[#F5EFE1] sm:text-4xl">
              Start converting more leads today
            </h2>
            <p className="mt-4 text-[#F5EFE1]/70">
              14-day free trial. No credit card required. Set up in minutes.
            </p>
            <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <Link
                href="/signup"
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-brand px-6 py-3 text-base font-semibold text-white hover:scale-[1.02] transition-all duration-150 shadow-sm"
              >
                Start free trial
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/login"
                className="w-full sm:w-auto inline-flex items-center justify-center rounded-lg border border-white/30 px-6 py-3 text-base font-semibold text-white hover:border-white/60 hover:bg-[#F5EFE1]/5 transition-colors"
              >
                Log in
              </Link>
            </div>
          </AnimatedSection>
        </section>

      </main>

      {/* ── Footer ───────────────────────────────────────────── */}
      <footer className="border-t border-gray-200 bg-[#F5EFE1] px-6 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 sm:flex-row">
          <div className="flex items-center gap-2.5">
            <SignatureLogo size="sm" variant="light-bg" animated />
            <span className="text-sm text-gray-400">· CRM for Aesthetic Clinics</span>
          </div>
          <div className="flex items-center gap-5 text-sm text-gray-500">
            <Link href="/pricing" className="hover:text-gray-900 transition-colors">Pricing</Link>
            <Link href="/privacy" className="hover:text-gray-900 transition-colors">Privacy</Link>
            <Link href="/terms" className="hover:text-gray-900 transition-colors">Terms</Link>
            <Link href="/sms-consent" className="hover:text-gray-900 transition-colors">SMS Consent</Link>
            <Link href="/login" className="hover:text-gray-900 transition-colors">Log in</Link>
            <Link href="/signup" className="hover:text-gray-900 transition-colors">Sign up</Link>
            <span>© {new Date().getFullYear()} Tarhunna</span>
          </div>
        </div>
      </footer>

    </div>
    </SmoothScrollProvider>
  )
}
