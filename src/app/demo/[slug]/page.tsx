import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PhoneCall, ArrowRight, CheckCircle } from 'lucide-react'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { LogoMark } from '@/components/ui/logo-mark'
import { TalkToLayla } from '@/components/marketing/talk-to-layla'

/**
 * Personalized prospect demo — the sharpest email we can send.
 *
 * Each /demo/[slug] page is private, unindexed, and built for exactly
 * one clinic on the outreach list: their name in the headline, THEIR
 * front desk answering when they click the button (the grant route
 * resolves the slug to a cloned, capped Vapi assistant). The pitch
 * stops being "imagine an AI receptionist" and becomes "you're
 * talking to yours."
 *
 * Rows live in demo_prospects (service-role only; created by
 * scripts/spin-prospect-demo.ts). Unknown slugs 404.
 */

export const metadata: Metadata = {
  title: 'Your front desk, answered — a Tarhunna demo',
  robots: { index: false, follow: false },
}

// Always render fresh — prospect rows are created between deploys.
export const dynamic = 'force-dynamic'

export default async function ProspectDemoPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const { data: prospect } = await supabaseAdmin
    .from('demo_prospects')
    .select('slug, clinic_name, city, services')
    .eq('slug', slug)
    .maybeSingle()

  if (!prospect) notFound()

  const services = (prospect.services ?? []).slice(0, 4)

  return (
    <div className="landing-page flex min-h-screen flex-col bg-[#F5EFE1]">
      <header className="border-b border-gray-100 bg-[#F5EFE1]">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-3">
          <Link href="/" aria-label="Tarhunna" className="flex items-center">
            <LogoMark size="md" />
          </Link>
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
            A private demo — not a live clinic line
          </span>
        </div>
      </header>

      <main className="flex-1 px-6 py-16 sm:py-24">
        <div className="mx-auto max-w-3xl text-center">
          <p className="rise text-xs font-semibold uppercase tracking-widest text-[#028090]" style={{ '--stagger': 0 } as React.CSSProperties}>
            Prepared for {prospect.clinic_name}
            {prospect.city ? ` · ${prospect.city}` : ''}
          </p>
          <h1 className="rise mt-4 text-4xl font-extrabold leading-[1.08] tracking-tight text-gray-900 sm:text-5xl" style={{ '--stagger': 1 } as React.CSSProperties}>
            This is what your phone
            <br />
            sounds like <span className="text-[#14241d]">answered.</span>
          </h1>
          <p className="rise mx-auto mt-5 max-w-xl text-lg text-gray-500" style={{ '--stagger': 2 } as React.CSSProperties}>
            We trained Layla, our AI receptionist, on {prospect.clinic_name} —
            your services, your hours-style questions, your callers. Click
            below and she&apos;ll answer the way she would if she worked your
            front desk today.
          </p>

          <div className="rise mx-auto mt-10 flex w-fit max-w-full flex-col items-center gap-2 rounded-2xl border border-brand-500/40 bg-brand-500/[0.07] px-8 py-6" style={{ '--stagger': 3 } as React.CSSProperties}>
            <span className="relative flex h-10 w-10 items-center justify-center rounded-full bg-brand-500/15">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-500/30 [animation-duration:2.2s]" />
              <PhoneCall className="relative h-4 w-4 text-[#028090]" />
            </span>
            <TalkToLayla
              slug={prospect.slug}
              offerLabel={`Talk to ${prospect.clinic_name}'s Layla →`}
            />
            <p className="text-[12px] text-gray-500">
              In your browser, right now. Ask to book
              {services.length > 0 ? ` ${String(services[0]).toLowerCase()}` : ' an appointment'}.
              Ask what she can&apos;t answer. Try to stump her.
            </p>
          </div>

          <div className="rise mt-10 flex flex-col items-center gap-2 sm:flex-row sm:justify-center sm:gap-6" style={{ '--stagger': 4 } as React.CSSProperties}>
            {[
              'Answers 24/7 — even when the room is full',
              'Books while the caller is on the line',
              'Texts the confirmation before goodbye',
            ].map((item) => (
              <div key={item} className="flex items-center gap-1.5 text-sm text-gray-500">
                <CheckCircle className="h-4 w-4 shrink-0 text-brand-500" />
                {item}
              </div>
            ))}
          </div>

          <div className="rise mx-auto mt-14 max-w-xl rounded-2xl border border-gray-200 bg-[#FAF6EC] px-7 py-6 text-left" style={{ '--stagger': 5 } as React.CSSProperties}>
            <p className="text-sm leading-relaxed text-gray-600">
              This demo is grounded on your public info and a sample
              calendar — the real thing runs on your live services, your
              real availability, and your own phone number, with every call
              logged in a CRM built for aesthetic medicine. Setting it up
              takes an afternoon, and you&apos;ll work with a founder, not a
              sales rep.
            </p>
            <div className="mt-5 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
              <Link
                href="/book-demo"
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-brand px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-150 hover:scale-[1.02]"
              >
                Talk to the founders
                <ArrowRight className="h-4 w-4" />
              </Link>
              <a
                href="tel:+13019622856"
                className="text-sm font-semibold text-[#026B78] underline-offset-4 hover:underline"
              >
                Or hear the phone version: (301) 962-2856
              </a>
            </div>
          </div>
        </div>
      </main>

      <footer className="border-t border-gray-200 bg-[#F5EFE1] px-6 py-6">
        <div className="mx-auto flex max-w-3xl flex-col items-center justify-between gap-2 text-xs text-gray-400 sm:flex-row">
          <span>Prepared by Tarhunna · Frederick, Maryland</span>
          <span>
            Private link for {prospect.clinic_name} — this page is not a live
            clinic phone line.
          </span>
        </div>
      </footer>
    </div>
  )
}
