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
} from 'lucide-react'

export const metadata: Metadata = {
  title: 'Tarhunna — CRM for Aesthetic Clinics',
  description:
    'Tarhunna helps med spas, aesthetic clinics, and plastic surgery practices capture leads, automate follow-up, schedule consultations, and reduce no-shows — all in one platform.',
}

const FEATURES = [
  {
    icon: Users,
    title: 'Lead Capture Forms',
    body: 'Embed a branded intake form on your website. Every inquiry lands directly in your CRM — no manual entry.',
  },
  {
    icon: LayoutGrid,
    title: 'Leads & Pipeline',
    body: 'See every lead at a glance. Move contacts through your pipeline from inquiry to booked consultation.',
  },
  {
    icon: CalendarDays,
    title: 'Consultation Scheduling',
    body: 'Book, track, and manage consultations. See exactly who is coming in and when.',
  },
  {
    icon: Zap,
    title: 'Automated Follow-Up',
    body: 'Set up follow-up sequences that run automatically. Nurture leads without lifting a finger.',
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
  { number: '01', title: 'Capture the inquiry', body: 'A patient fills out your intake form. Their info lands in Tarhunna instantly.' },
  { number: '02', title: 'Organize the lead', body: 'Add them to your pipeline, tag their procedure interest, and assign to a team member.' },
  { number: '03', title: 'Follow up automatically', body: 'Sequences handle the nurture — emails go out on schedule without you thinking about it.' },
  { number: '04', title: 'Book the consultation', body: 'Log the consultation, send a reminder, and show up ready. No-shows drop. Revenue grows.' },
]

const CLINIC_TYPES = [
  { label: 'Med Spas', description: 'Botox, fillers, laser, and wellness — manage every inquiry and convert more bookings.' },
  { label: 'Aesthetic Clinics', description: 'From first inquiry to loyal patient. Keep your pipeline full and your follow-up consistent.' },
  { label: 'Plastic Surgery Practices', description: 'Long consideration cycles need smart follow-up. Tarhunna keeps leads warm until the patient is ready.' },
]

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-white">

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
              <span className="text-xs font-semibold uppercase tracking-wider text-indigo-600">14-day free trial · No credit card</span>
            </div>
            <h1 className="text-4xl font-extrabold tracking-tight text-gray-900 sm:text-5xl lg:text-6xl">
              The CRM built for<br className="hidden sm:block" /> aesthetic clinics
            </h1>
            <p className="mt-5 text-lg text-gray-500 sm:text-xl max-w-2xl mx-auto">
              Capture leads, automate follow-up, schedule consultations, and reduce no-shows —
              all in one platform built for med spas and aesthetic practices.
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
                href="/login"
                className="w-full sm:w-auto inline-flex items-center justify-center rounded-lg border border-gray-200 bg-white px-6 py-3 text-base font-semibold text-gray-700 hover:border-gray-300 hover:text-gray-900 transition-colors"
              >
                Log in
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

        {/* ── Features ─────────────────────────────────────────── */}
        <section className="bg-gray-50 px-6 py-20">
          <div className="mx-auto max-w-6xl">
            <div className="mb-12 text-center">
              <h2 className="text-3xl font-bold tracking-tight text-gray-900">
                Everything your clinic needs to convert more leads
              </h2>
              <p className="mt-3 text-gray-500 max-w-xl mx-auto">
                Built specifically for aesthetic practices — not a generic CRM retrofitted for healthcare.
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

        {/* ── How it works ─────────────────────────────────────── */}
        <section className="bg-white px-6 py-20">
          <div className="mx-auto max-w-4xl">
            <div className="mb-12 text-center">
              <h2 className="text-3xl font-bold tracking-tight text-gray-900">How it works</h2>
              <p className="mt-3 text-gray-500">Four steps from first inquiry to booked consultation.</p>
            </div>
            <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map(({ number, title, body }) => (
                <div key={number} className="relative">
                  <div className="mb-4 text-3xl font-black text-indigo-100">{number}</div>
                  <h3 className="mb-2 text-base font-semibold text-gray-900">{title}</h3>
                  <p className="text-sm text-gray-500 leading-relaxed">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Who it's for ─────────────────────────────────────── */}
        <section className="bg-gray-50 px-6 py-20">
          <div className="mx-auto max-w-5xl">
            <div className="mb-12 text-center">
              <h2 className="text-3xl font-bold tracking-tight text-gray-900">Built for your type of clinic</h2>
              <p className="mt-3 text-gray-500">
                Whether you're a solo injector or a multi-provider practice, Tarhunna fits.
              </p>
            </div>
            <div className="grid gap-5 sm:grid-cols-3">
              {CLINIC_TYPES.map(({ label, description }) => (
                <div key={label} className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
                  <div className="mb-3 inline-flex rounded-full bg-indigo-50 px-3 py-1">
                    <span className="text-sm font-semibold text-indigo-600">{label}</span>
                  </div>
                  <p className="text-sm text-gray-500 leading-relaxed">{description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Final CTA ────────────────────────────────────────── */}
        <section className="bg-indigo-600 px-6 py-20">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Start converting more leads today
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
                href="/login"
                className="w-full sm:w-auto inline-flex items-center justify-center rounded-lg border border-indigo-400 px-6 py-3 text-base font-semibold text-white hover:border-indigo-300 hover:bg-indigo-500 transition-colors"
              >
                Log in
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
            <Link href="/login" className="hover:text-gray-900 transition-colors">Log in</Link>
            <Link href="/signup" className="hover:text-gray-900 transition-colors">Sign up</Link>
            <span>© {new Date().getFullYear()} Tarhunna</span>
          </div>
        </div>
      </footer>

    </div>
  )
}
