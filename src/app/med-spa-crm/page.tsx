import type { Metadata } from 'next'
import Link from 'next/link'
import {
  Users,
  CalendarDays,
  Zap,
  BellOff,
  LayoutGrid,
  FileText,
  CheckCircle,
  ArrowRight,
  AlertCircle,
} from 'lucide-react'

export const metadata: Metadata = {
  title: 'CRM for Med Spas — Tarhunna',
  description:
    'Tarhunna is CRM software built specifically for med spas. Capture leads, automate follow-up, book consultations, and reduce no-shows — all in one platform.',
  keywords: [
    'med spa CRM',
    'CRM for med spas',
    'med spa lead management',
    'med spa follow-up software',
    'med spa consultation software',
    'med spa no-show reduction',
    'medical spa CRM',
    'med spa patient management',
    'med spa pipeline software',
    'med spa lead capture',
  ],
  alternates: {
    canonical: 'https://tarhunna.net/med-spa-crm',
  },
  openGraph: {
    type: 'website',
    siteName: 'Tarhunna',
    title: 'CRM for Med Spas — Tarhunna',
    description:
      'Stop losing med spa leads. Tarhunna helps medical spas capture inquiries, automate follow-up, and book more consultations.',
    url: 'https://tarhunna.net/med-spa-crm',
    locale: 'en_US',
  },
}

// ── Page data ──────────────────────────────────────────────

const PAIN_POINTS = [
  'Inquiries come in from Instagram, your website, and referrals with no central system to track them',
  'Follow-up is inconsistent — leads go cold before they ever schedule a consultation',
  'No-shows happen because appointment reminders are manual, late, or skipped entirely',
  'Lead stages and notes live on spreadsheets or sticky notes with no unified system',
  'Front desk staff spend hours chasing leads instead of focusing on clients in the building',
]

const FEATURES = [
  {
    icon: FileText,
    title: 'Branded Intake Forms',
    body: 'Embed a custom intake form on your med spa website. Botox inquiries, filler consultations, laser bookings — every request lands in your CRM automatically, no manual entry.',
  },
  {
    icon: Users,
    title: 'Leads and Contact Records',
    body: 'Keep a complete record for every lead — procedure interest, contact history, pipeline stage, and notes. No more lost inquiries or scattered information.',
  },
  {
    icon: LayoutGrid,
    title: 'Pipeline Management',
    body: 'Move leads through your pipeline stages — new inquiry, follow-up sent, consultation booked, treatment scheduled. See every lead at a glance.',
  },
  {
    icon: CalendarDays,
    title: 'Consultation Scheduling',
    body: 'Track every consultation — who is coming in, what service they want, pre-consult notes, and post-visit follow-up. All tied to the lead record.',
  },
  {
    icon: Zap,
    title: 'Automated Follow-Up',
    body: 'Build follow-up sequences for Botox inquiries, filler consultations, and package renewals. Emails go out automatically — no chasing required.',
  },
  {
    icon: BellOff,
    title: 'No-Show Reduction',
    body: 'Automated appointment reminders go out before every consultation. Fewer no-shows means more revenue and a more predictable schedule.',
  },
]

const COMPARISONS = [
  {
    vs: 'Spreadsheets',
    heading: 'No more manual tracking',
    body: 'Spreadsheets require constant updates, miss follow-up deadlines, and give no real visibility into your pipeline. Tarhunna captures leads automatically and tracks every stage without manual entry.',
  },
  {
    vs: 'Generic CRMs',
    heading: 'Built for aesthetic practices',
    body: 'Generic CRMs are built for sales teams, not med spas. Tarhunna is designed around how aesthetic practices work — intake forms, consultation tracking, and follow-up sequences for services like Botox, fillers, and laser treatments.',
  },
  {
    vs: 'Patchwork systems',
    heading: 'One platform instead of four',
    body: 'Most med spas piece together a booking tool, an email app, a spreadsheet, and a notes system. Tarhunna replaces all of them with one connected platform that keeps everything in sync.',
  },
]

const FAQ_ITEMS = [
  {
    q: 'What is a med spa CRM?',
    a: 'A med spa CRM is software that helps medical spas manage leads, automate follow-up, track consultations, and organize patient communication in one place. Instead of spreadsheets and sticky notes, a CRM gives your team a central system to capture every inquiry and move it toward a booked consultation.',
  },
  {
    q: 'Is Tarhunna built for med spas?',
    a: 'Yes. Tarhunna is built specifically for aesthetic practices including med spas. Every feature — intake forms, lead pipeline, consultation tracking, and automated follow-up — is designed around how medical spas and aesthetic clinics actually operate.',
  },
  {
    q: 'Can Tarhunna automate follow-up for med spa leads?',
    a: 'Yes. You can build follow-up sequences that trigger automatically when a new lead comes in, a consultation is booked, or a patient goes no-show. Tarhunna sends the emails on schedule without any manual work from your team.',
  },
  {
    q: 'Can Tarhunna help reduce no-shows at my med spa?',
    a: 'Yes. Tarhunna sends automated appointment reminders before every consultation. When patients receive timely reminders, no-show rates drop and your schedule stays full.',
  },
  {
    q: 'Does Tarhunna replace my EMR?',
    a: 'No. Tarhunna is a CRM and lead management platform, not an electronic medical records system. It handles the front-of-funnel — capturing leads, automating follow-up, and tracking consultations — and works alongside your existing EMR.',
  },
  {
    q: 'Can I track consultations and lead stages in one place?',
    a: 'Yes. Tarhunna gives you a pipeline view of every lead and a consultation log tied to each patient record. You can see where every lead stands — new inquiry, follow-up sent, consultation booked — all in one dashboard.',
  },
]

// ── Page ───────────────────────────────────────────────────

export default function MedSpaCRMPage() {
  return (
    <div className="flex min-h-screen flex-col bg-white">

      {/* FAQPage schema */}
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

      {/* WebPage schema */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'WebPage',
            name: 'CRM for Med Spas — Tarhunna',
            url: 'https://tarhunna.net/med-spa-crm',
            description: 'CRM software built specifically for med spas. Capture leads, automate follow-up, book consultations, and reduce no-shows.',
            isPartOf: { '@type': 'WebSite', name: 'Tarhunna', url: 'https://tarhunna.net' },
          }),
        }}
      />

      {/* ── Nav ──────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 border-b border-gray-100 bg-white/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600">
              <span className="text-sm font-black text-white">T</span>
            </div>
            <span className="text-base font-bold text-gray-900">Tarhunna</span>
          </Link>
          <nav className="flex items-center gap-3">
            <Link
              href="/login"
              className="text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
            >
              Log in
            </Link>
            <Link
              href="/signup"
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 transition-colors"
            >
              Start free trial
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">

        {/* ── Hero ─────────────────────────────────────────────── */}
        <section className="bg-white px-6 py-20 sm:py-28">
          <div className="mx-auto max-w-3xl text-center">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-indigo-100 bg-indigo-50 px-4 py-1.5">
              <span className="text-xs font-semibold uppercase tracking-wider text-indigo-600">
                Med Spa CRM · 14-day free trial
              </span>
            </div>
            <h1 className="text-4xl font-extrabold tracking-tight text-gray-900 sm:text-5xl lg:text-6xl">
              CRM Software Built<br className="hidden sm:block" /> for Med Spas
            </h1>
            <p className="mt-5 text-lg text-gray-500 sm:text-xl max-w-2xl mx-auto">
              Capture every inquiry, automate follow-up, book consultations, and reduce
              no-shows — with a CRM designed specifically for medical spas and aesthetic practices.
            </p>
            <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <Link
                href="/signup"
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-6 py-3 text-base font-semibold text-white hover:bg-indigo-700 transition-colors shadow-sm"
              >
                Start free trial
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/signup"
                className="w-full sm:w-auto inline-flex items-center justify-center rounded-lg border border-gray-200 bg-white px-6 py-3 text-base font-semibold text-gray-700 hover:border-gray-300 hover:text-gray-900 transition-colors"
              >
                Book a demo
              </Link>
            </div>
            <div className="mt-8 flex flex-col items-center gap-2 sm:flex-row sm:justify-center sm:gap-6">
              {['No credit card required', 'Setup in under 5 minutes', 'Cancel anytime'].map((item) => (
                <div key={item} className="flex items-center gap-1.5 text-sm text-gray-500">
                  <CheckCircle className="h-4 w-4 text-emerald-500 shrink-0" />
                  {item}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Problem ──────────────────────────────────────────── */}
        <section className="bg-gray-50 px-6 py-20">
          <div className="mx-auto max-w-3xl">
            <div className="mb-10 text-center">
              <h2 className="text-3xl font-bold tracking-tight text-gray-900">
                Med spas lose revenue when leads fall through the cracks
              </h2>
              <p className="mt-4 text-gray-500 max-w-xl mx-auto">
                Most med spas attract plenty of interest — but without a proper system,
                that interest disappears. Inquiries go unanswered. Follow-up gets skipped.
                Consultations get missed.
              </p>
            </div>
            <ul className="space-y-3 max-w-xl mx-auto">
              {PAIN_POINTS.map((point) => (
                <li
                  key={point}
                  className="flex items-start gap-3 rounded-lg border border-red-100 bg-red-50 px-5 py-4"
                >
                  <AlertCircle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
                  <span className="text-sm text-gray-700">{point}</span>
                </li>
              ))}
            </ul>
            <p className="mt-8 text-center text-sm font-medium text-gray-500">
              Tarhunna was built to solve exactly these problems — for med spas specifically.
            </p>
          </div>
        </section>

        {/* ── Features ─────────────────────────────────────────── */}
        <section className="bg-white px-6 py-20">
          <div className="mx-auto max-w-6xl">
            <div className="mb-12 text-center">
              <h2 className="text-3xl font-bold tracking-tight text-gray-900">
                Every tool a med spa needs to fill the schedule
              </h2>
              <p className="mt-3 text-gray-500 max-w-xl mx-auto">
                Not a generic CRM adapted for healthcare. Every feature is built around
                how medical spas and aesthetic clinics actually run their business.
              </p>
            </div>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(({ icon: Icon, title, body }) => (
                <div key={title} className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
                  <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50">
                    <Icon className="h-5 w-5 text-indigo-600" />
                  </div>
                  <h3 className="mb-2 text-base font-semibold text-gray-900">{title}</h3>
                  <p className="text-sm text-gray-500 leading-relaxed">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Why Tarhunna ─────────────────────────────────────── */}
        <section className="bg-gray-50 px-6 py-20">
          <div className="mx-auto max-w-5xl">
            <div className="mb-12 text-center">
              <h2 className="text-3xl font-bold tracking-tight text-gray-900">
                Why med spas choose Tarhunna over spreadsheets and generic CRMs
              </h2>
              <p className="mt-3 text-gray-500 max-w-xl mx-auto">
                Most practices try to make do with tools that were never built for them.
                There is a better option.
              </p>
            </div>
            <div className="grid gap-5 sm:grid-cols-3">
              {COMPARISONS.map(({ vs, heading, body }) => (
                <div key={vs} className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
                  <div className="mb-3 inline-flex rounded-full bg-red-50 px-3 py-1">
                    <span className="text-xs font-semibold text-red-500">vs. {vs}</span>
                  </div>
                  <h3 className="mb-2 text-base font-semibold text-gray-900">{heading}</h3>
                  <p className="text-sm text-gray-500 leading-relaxed">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── FAQ ──────────────────────────────────────────────── */}
        <section className="bg-white px-6 py-20">
          <div className="mx-auto max-w-3xl">
            <div className="mb-12 text-center">
              <h2 className="text-3xl font-bold tracking-tight text-gray-900">
                Frequently asked questions about med spa CRM software
              </h2>
            </div>
            <dl className="divide-y divide-gray-200 rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
              {FAQ_ITEMS.map(({ q, a }) => (
                <div key={q} className="px-6 py-5">
                  <dt className="mb-2 text-sm font-semibold text-gray-900">{q}</dt>
                  <dd className="text-sm text-gray-500 leading-relaxed">{a}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* ── Final CTA ────────────────────────────────────────── */}
        <section className="bg-indigo-600 px-6 py-20">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Start filling your med spa schedule today
            </h2>
            <p className="mt-4 text-indigo-200">
              14-day free trial. No credit card required. Set up in minutes.
            </p>
            <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <Link
                href="/signup"
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg bg-white px-6 py-3 text-base font-semibold text-indigo-600 hover:bg-indigo-50 transition-colors shadow-sm"
              >
                Start free trial
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/signup"
                className="w-full sm:w-auto inline-flex items-center justify-center rounded-lg border border-indigo-400 px-6 py-3 text-base font-semibold text-white hover:border-indigo-300 hover:bg-indigo-500 transition-colors"
              >
                Book a demo
              </Link>
            </div>
          </div>
        </section>

      </main>

      {/* ── Footer ───────────────────────────────────────────── */}
      <footer className="border-t border-gray-200 bg-white px-6 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 sm:flex-row">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600">
              <span className="text-xs font-black text-white">T</span>
            </div>
            <span className="text-sm font-bold text-gray-900">Tarhunna</span>
            <span className="text-sm text-gray-400">· CRM for Aesthetic Clinics</span>
          </div>
          <div className="flex items-center gap-5 text-sm text-gray-500">
            <Link href="/" className="hover:text-gray-900 transition-colors">Home</Link>
            <Link href="/login" className="hover:text-gray-900 transition-colors">Log in</Link>
            <Link href="/signup" className="hover:text-gray-900 transition-colors">Sign up</Link>
            <span>© {new Date().getFullYear()} Tarhunna</span>
          </div>
        </div>
      </footer>

    </div>
  )
}
