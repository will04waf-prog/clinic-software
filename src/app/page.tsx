import type { Metadata } from 'next'
import Link from 'next/link'
import {
  PhoneCall,
  PhoneIncoming,
  PhoneOutgoing,
  MessageSquareText,
  CalendarCheck,
  Voicemail,
  LayoutGrid,
  ShieldCheck,
  Layers,
  CheckCircle,
  ArrowRight,
  ChevronDown,
  Sparkles,
  ClipboardList,
  Users,
  Workflow,
} from 'lucide-react'
import { HomeProductShowcase } from './home-product-showcase'
import { SignatureLogo } from '@/components/ui/signature-logo'
import { LogoMark } from '@/components/ui/logo-mark'
import { AnimatedSection } from '@/components/marketing/animated-section'
import { AnimatedCard } from '@/components/marketing/animated-card'
import { SmoothScrollProvider } from '@/components/marketing/smooth-scroll-provider'
import { ParallaxGlow } from '@/components/marketing/parallax-glow'

export const metadata: Metadata = {
  title: 'Tarhunna — AI receptionist that books appointments, backed by a full CRM',
  description:
    "Layla picks up the phone, books appointments, texts the link, and writes back to inbound SMS in your voice — so leads stop slipping while your front desk is on another call.",
  alternates: {
    canonical: 'https://tarhunna.net',
  },
  openGraph: {
    type: 'website',
    siteName: 'Tarhunna',
    title: 'Tarhunna — AI receptionist that books appointments, backed by a full CRM',
    description:
      "An AI receptionist that answers every call, books on the line, texts the link, and writes back to inbound SMS in your voice. Backed by the CRM where every call, text, and booking lands.",
    url: 'https://tarhunna.net',
    locale: 'en_US',
  },
}

// ── Page data ─────────────────────────────────────────────

// Tier ladder pill — explicit about what unlocks where
type Tier = 'starter' | 'professional' | 'scale' | 'any'

const TIER_LABEL: Record<Tier, string> = {
  starter: 'Starter',
  professional: 'Professional',
  scale: 'Scale',
  any: 'Every plan',
}

// Tier styling — uses brand tokens already in globals.css
const TIER_CLASS: Record<Tier, string> = {
  starter: 'bg-[#B5710F]/15 text-[#B5710F] border-[#B5710F]/30',
  professional: 'bg-brand-600/15 text-brand-700 border-brand-600/30',
  scale: 'bg-brand-500/15 text-[#026B78] border-brand-500/40',
  any: 'bg-gray-100 text-gray-600 border-gray-200',
}

// Layla's voice tools — receptionist verbs, grounded in the actual 16-tool inventory
const VOICE_TOOLS = [
  'Answers inbound calls 24/7 or after-hours',
  'Looks up the clinic\'s services and hours',
  'Matches a service the caller asked for by name',
  'Finds 1-2 open consultation slots on the line',
  'Holds the slot and confirms the booking verbally',
  'Confirms or reschedules existing appointments',
  'Cancels an appointment when the patient asks',
  'Looks up a caller\'s own appointment (caller-ID gated)',
  'Texts the booking, manage, intake, or directions link mid-call',
  'Gives directions to your clinic',
  'Reads your FAQ entries verbatim',
  'Reads pre-visit instructions on request',
  'Takes a message when she can\'t resolve it',
  'Transfers to a human you nominate',
  'Sends a PHI-free post-call summary to the owner',
  'Declines pricing and medical questions, by design',
]

// Top-level "what gets installed" sections — match narrative_order in the brief
const PILLAR_SECTIONS = [
  {
    icon: PhoneIncoming,
    eyebrow: 'Inbound voice',
    title: 'Layla answers the phone',
    oneLine: 'An AI voice receptionist that picks up inbound calls 24/7 or after-hours, in your clinic\'s voice.',
    body: 'Layla is a Vapi-backed voice agent that answers your Twilio number and talks to callers like a trained front-desk hire. She greets, listens, asks the right intake questions, and resolves the call — or transfers to a human you nominate. Owners choose always-on or after-hours-only, and set a fallback number for anything Layla can\'t handle.',
    tier: 'scale' as Tier,
  },
  {
    icon: CalendarCheck,
    eyebrow: 'Live booking',
    title: 'She books appointments live, on the call',
    oneLine: 'Layla checks real provider availability and confirms a slot before the caller hangs up.',
    body: 'Layla reads your service catalog, your providers\' weekly hours, and date-specific overrides — then offers slots that actually exist. She holds the time, confirms it verbally, books the consultation in your calendar, and texts a confirmation. No "we\'ll call you back" loop, no double-booking, no slots invented out of thin air.',
    tier: 'scale' as Tier,
  },
  {
    icon: PhoneOutgoing,
    eyebrow: 'Outbound reminders',
    title: 'She calls back the day before, too',
    oneLine: 'Layla phones patients 4–72 hours before their visit so they can confirm, move, or cancel by voice.',
    body: 'An hourly cron places outbound reminder calls into the day-before window you choose. Patients confirm, reschedule onto another open slot, cancel, or ask for a callback — entirely by voice. The result is fewer empty chairs without your team dialing through tomorrow\'s schedule by hand. Outbound reminders don\'t transfer to a live human, since the clinic may be closed.',
    tier: 'scale' as Tier,
  },
  {
    icon: MessageSquareText,
    eyebrow: 'SMS twin',
    title: 'Your SMS replies, written in your voice',
    oneLine: 'Inbound texts come back with a ready-to-send reply that already includes real open slots.',
    body: 'Train a per-clinic writing profile once. After that, every inbound SMS gets an AI-drafted response in your tone, with genuinely available booking times pulled from your live calendar pasted into the body. On Professional you approve each send. On Scale, the AI Twin sends autonomously. Either way, you stop losing leads to the "we\'ll text you back tomorrow" gap.',
    tier: 'professional' as Tier,
  },
  {
    icon: CalendarCheck,
    eyebrow: 'Self-service',
    title: 'Patients book and reschedule themselves',
    oneLine: 'A public booking page per clinic and signed SMS links that let patients move their own visit.',
    body: 'Your /book/[slug] page lets new patients pick a service and a provider, see real availability, and confirm a hold. Existing patients get a /manage link via SMS so they can reschedule or cancel themselves — no email tag, no front-desk involvement. Confirmation SMS goes to the patient and a notification email to the owner.',
    tier: 'starter' as Tier,
  },
  {
    icon: Voicemail,
    eyebrow: 'Missed-call recovery',
    title: 'Nothing falls through',
    oneLine: 'Every call Layla can\'t resolve becomes a message in a real inbox, not a Post-it.',
    body: 'When Layla takes a message you get a PHI-scrubbed summary email and a row in /voice-messages with the linked call context. Every call she handles also writes a call_logs entry with transcript, disposition, duration, and recording URL — searchable, reviewable, and tied to the contact. Triage tomorrow morning from one screen instead of a voicemail box.',
    tier: 'scale' as Tier,
  },
] as const

// CRM foundation block — five concrete pieces, framed as "where every call lands"
const CRM_PIECES = [
  {
    icon: Users,
    title: 'Contacts with full timelines',
    body: 'Every call Layla takes, every SMS the AI Twin sends, every booking from the public page lands on one contact record with a complete activity timeline.',
  },
  {
    icon: LayoutGrid,
    title: 'Kanban pipeline + consultations calendar',
    body: 'Drag leads through stages. Drag consultations to reschedule them. Tag and segment contacts, add notes, and invite staff with roles.',
  },
  {
    icon: Workflow,
    title: 'Automation sequences',
    body: 'Multi-step email + SMS sequences off six triggers: new_lead, stage_changed, consultation_booked, consultation_completed, no_show, and old_lead_reactivation.',
  },
  {
    icon: MessageSquareText,
    title: 'Threaded two-way SMS',
    body: 'Send manual or AI-drafted SMS from a contact\'s page. Replies thread back on the same Twilio number you already own. STOP/HELP keywords honored automatically.',
  },
  {
    icon: Sparkles,
    title: 'AI lead summary on every contact',
    body: 'Open a contact, see an AI-generated brief of their history — source, stage, last touch, and what they\'ve asked for — before you call back.',
  },
  {
    icon: ClipboardList,
    title: 'Multi-tenant by construction',
    body: 'Multi-tenant isolation is enforced at both the query layer and via Postgres RLS org_isolation policies. Your data stays your data.',
  },
]

// Tier ladder — exactly what unlocks where, no salesman gloss
type TierCard = {
  name: string
  price: string
  cap: string
  includes: readonly string[]
  highlighted?: boolean
}

const TIERS: readonly TierCard[] = [
  {
    name: 'Starter',
    price: '$147',
    cap: '500 contacts · 2 seats',
    includes: [
      'Full CRM: contacts, pipeline, calendar, tags, notes, timeline',
      'Public /book/[slug] page + signed /manage reschedule links',
      'Two-way SMS threading on your Twilio number',
      'AI lead summary on every contact',
    ],
  },
  {
    name: 'Professional',
    price: '$297',
    cap: '2,500 contacts · 5 seats',
    includes: [
      'Everything in Starter',
      'AI Twin SMS drafts — owner approves each send',
      'Automation sequences (6 triggers)',
      'Editable 24h and 2h consultation reminder templates',
      'Bulk CSV import',
    ],
    highlighted: true,
  },
  {
    name: 'Scale',
    price: '$497',
    cap: 'Unlimited contacts · unlimited seats',
    includes: [
      'Everything in Professional',
      'Layla — full inbound AI voice receptionist (16 tools)',
      'Outbound AI reminder calls 4–72h ahead',
      'AI Twin SMS sends autonomously',
      'Call logs with transcript, disposition, recording URL',
      'Voice messages inbox + post-call summary email',
    ],
  },
]

// FAQ — rewritten around the new positioning
const FAQ_ITEMS = [
  {
    q: 'What is Tarhunna?',
    a: 'Tarhunna is an AI receptionist plus a patient-communications stack, sitting on top of a full clinic CRM. Layla — the AI voice receptionist — answers your phone, books appointments on the line, calls patients back the day before, and writes inbound SMS replies in your voice. Every call, text, and booking lands in the CRM underneath.',
  },
  {
    q: 'What plan do I need to get Layla, the AI voice receptionist?',
    a: 'Layla\'s full voice agent (inbound calls and outbound AI reminder calls) is on the Scale tier. AI Twin SMS drafts unlock on Professional. The CRM, the public booking page, and threaded two-way SMS are available on every plan, including Starter.',
  },
  {
    q: 'Does Layla use my phone number?',
    a: 'Yes — Layla answers calls on your Twilio number, not a shared shortcode or rebranded sender. Inbound SMS replies thread on the same number. There is no separate caller ID for the AI.',
  },
  {
    q: 'How does Layla avoid making things up?',
    a: 'Layla is grounded in three things you author: your service catalog, your providers\' weekly hours and overrides, and your own FAQ corpus that she reads verbatim. She refuses to quote prices, give post-care or medical advice, or accept a dictated phone number as identity — appointment lookups are gated on the caller\'s verified caller-ID.',
  },
  {
    q: 'Is Tarhunna HIPAA compliant?',
    a: 'Vendor BAAs are available with Vapi, Twilio, Supabase, Stripe, and Resend, and an in-app BAA attestation is required before the voice agent will accept inbound or place outbound calls. Data is encrypted at rest via Supabase/Postgres infrastructure. We do not market the product as "HIPAA compliant" as a checkbox — compliance is shared between your clinic and the platform.',
  },
  {
    q: 'Does Tarhunna replace my EMR?',
    a: 'No. Tarhunna handles the front of the funnel — answering calls, capturing leads, booking consultations, and following up — and sits alongside your existing EMR. There is no EMR, Google Calendar, Outlook, or Meta Lead Ads integration today.',
  },
  {
    q: 'How long does setup take?',
    a: 'Most clinics are running the CRM and the public booking page in under 20 minutes. Bringing Layla online takes longer because you need to author your FAQ corpus, attest to the BAA, and port or buy a Twilio number — usually a single afternoon with the founder.',
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
            description:
              'AI receptionist and patient-communications platform for clinics, backed by a full CRM.',
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
            description: 'AI receptionist that books appointments, backed by a full CRM',
            publisher: { '@type': 'Organization', name: 'Tarhunna' },
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
            description:
              'AI voice receptionist that answers, books, and reminds — backed by a full clinic CRM, two-way SMS, and automation sequences.',
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
          <Link href="/" aria-label="Tarhunna" className="flex items-center">
            <LogoMark size="md" priority />
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
                An AI receptionist that answers every call, backed by a full CRM.
              </p>
            </div>
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-brand-500/40 bg-brand-500/15 px-4 py-1.5">
              <PhoneCall className="h-3.5 w-3.5 text-[#14241d]" />
              <span className="text-xs font-semibold uppercase tracking-wider text-[#14241d]">
                Meet Layla — voice + SMS + CRM in one
              </span>
            </div>
            <h1 className="text-4xl font-extrabold leading-[1.08] tracking-tight text-gray-900 sm:text-5xl lg:text-6xl">
              An AI receptionist that actually <span className="text-[#14241d]">books appointments</span>.
            </h1>
            <p className="mt-5 text-lg text-gray-500 sm:text-xl max-w-2xl mx-auto">
              Layla picks up the phone, books appointments, texts the link, and writes back to inbound SMS in your voice —
              so leads stop slipping while your front desk is on another call.
            </p>
            <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <Link
                href="/signup"
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-brand px-6 py-3 text-base font-semibold text-white hover:scale-[1.02] transition-all duration-150 shadow-sm"
              >
                Start 14-day free trial
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/book-demo"
                className="w-full sm:w-auto inline-flex items-center justify-center rounded-lg border border-gray-300 bg-[#F5EFE1] px-6 py-3 text-base font-semibold text-gray-700 hover:border-gray-400 hover:text-gray-900 transition-colors"
              >
                Book a 20-min demo
              </Link>
            </div>
            <div className="mt-8 flex flex-col items-center gap-2 sm:flex-row sm:justify-center sm:gap-6">
              {['No credit card required', 'Setup in less than 20 minutes', 'Cancel anytime'].map((item) => (
                <div key={item} className="flex items-center gap-1.5 text-sm text-gray-500">
                  <CheckCircle className="h-4 w-4 text-brand-500 shrink-0" />
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

        {/* ── Value pillars strip — rewritten around voice + comms + CRM ─── */}
        <section className="bg-[#F5EFE1] px-6 pt-10">
          <AnimatedSection className="mx-auto max-w-5xl">
            <div className="grid gap-px overflow-hidden rounded-2xl border border-gray-200 bg-gray-200 shadow-sm sm:grid-cols-3">
              {[
                { stat: '16 voice tools', label: 'Layla can book, reschedule, transfer, take messages, and more on every call' },
                { stat: 'Day-before recall', label: 'Outbound AI reminder calls 4–72 hours ahead — patients confirm or move by voice' },
                { stat: 'One stack', label: 'Voice, two-way SMS, public booking, and CRM on a single Twilio number' },
              ].map(({ stat, label }) => (
                <div key={stat} className="bg-[#F5EFE1] px-6 py-6 text-center">
                  <div className="text-xl font-extrabold tracking-tight text-[#14241d]">{stat}</div>
                  <p className="mt-1 text-sm text-gray-500 leading-relaxed">{label}</p>
                </div>
              ))}
            </div>
          </AnimatedSection>
        </section>

        {/* ── Product Showcase — keeps the existing visual scaffolding ─── */}
        <HomeProductShowcase />

        {/* ── What Layla does on every call ──────────────────── */}
        <section className="bg-[#F5EFE1] px-6 py-20">
          <div className="mx-auto max-w-5xl">
            <AnimatedSection className="mb-12 text-center">
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-brand-500/40 bg-brand-500/10 px-3 py-1">
                <span className="text-xs font-semibold uppercase tracking-wider text-[#14241d]">
                  Layla · voice receptionist
                </span>
                <span className={`text-[10px] font-semibold uppercase tracking-wider rounded-full border px-2 py-0.5 ${TIER_CLASS.scale}`}>
                  {TIER_LABEL.scale}
                </span>
              </div>
              <h2 className="text-3xl font-bold tracking-tight text-gray-900">
                What Layla does on every call
              </h2>
              <p className="mt-3 text-gray-500 max-w-xl mx-auto">
                Sixteen voice tools, written as receptionist verbs — not features.
                Inbound calls cost you nothing if your team is already on another line.
              </p>
            </AnimatedSection>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {VOICE_TOOLS.map((tool, index) => (
                <AnimatedCard
                  key={tool}
                  index={index}
                  className="flex items-start gap-3 rounded-xl border border-gray-200 bg-[#FAF6EC] px-5 py-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-500/40 hover:shadow-md"
                >
                  <div className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-brand-500/15">
                    <PhoneCall className="h-3.5 w-3.5 text-[#026B78]" />
                  </div>
                  <p className="text-sm text-gray-700 leading-snug">{tool}</p>
                </AnimatedCard>
              ))}
            </div>
          </div>
        </section>

        {/* ── Pillar sections — the full inventory, narratively ordered ─── */}
        <section className="bg-[#FAF6EC] px-6 py-20">
          <div className="mx-auto max-w-6xl">
            <AnimatedSection className="mb-12 text-center">
              <h2 className="text-3xl font-bold tracking-tight text-gray-900">
                Voice, then SMS, then booking, then the CRM underneath
              </h2>
              <p className="mt-3 text-gray-500 max-w-2xl mx-auto">
                The receptionist stack ships top-to-bottom. Every layer lands on the same contact record.
              </p>
            </AnimatedSection>
            <div className="grid gap-5 lg:grid-cols-2">
              {PILLAR_SECTIONS.map(({ icon: Icon, eyebrow, title, oneLine, body, tier }, index) => (
                <AnimatedCard
                  key={title}
                  index={index}
                  className="flex flex-col rounded-2xl border border-gray-200 bg-[#F5EFE1] p-7 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
                >
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-brand-500/15">
                        <Icon className="h-5 w-5 text-[#026B78]" />
                      </div>
                      <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                        {eyebrow}
                      </span>
                    </div>
                    <span className={`text-[10px] font-semibold uppercase tracking-wider rounded-full border px-2 py-0.5 ${TIER_CLASS[tier]}`}>
                      {TIER_LABEL[tier]}
                    </span>
                  </div>
                  <h3 className="text-xl font-semibold text-gray-900">{title}</h3>
                  <p className="mt-2 text-sm font-medium text-[#14241d]">{oneLine}</p>
                  <p className="mt-3 text-sm text-gray-600 leading-relaxed">{body}</p>
                </AnimatedCard>
              ))}
            </div>
          </div>
        </section>

        {/* ── CRM foundation — reframed as where every call lands ─── */}
        <section className="bg-[#14241d] px-6 py-20">
          <div className="mx-auto max-w-6xl">
            <AnimatedSection className="mb-12 text-center">
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-brand-500/30 bg-brand-500/10 px-3 py-1">
                <span className="text-xs font-semibold uppercase tracking-wider text-[#F5EFE1]">
                  The CRM underneath it all
                </span>
                <span className={`text-[10px] font-semibold uppercase tracking-wider rounded-full border px-2 py-0.5 ${TIER_CLASS.any}`}>
                  {TIER_LABEL.any}
                </span>
              </div>
              <h2 className="text-3xl font-bold tracking-tight text-[#F5EFE1]">
                Where every call, text, and booking lands
              </h2>
              <p className="mt-3 text-[#F5EFE1]/70 max-w-2xl mx-auto">
                Layla and the AI Twin sit on a real clinic CRM — contacts, kanban pipeline, consultations calendar,
                tags, notes, activity timeline, automation sequences, and team seats. Multi-tenant isolation is
                enforced at the query layer and at Postgres RLS.
              </p>
            </AnimatedSection>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {CRM_PIECES.map(({ icon: Icon, title, body }, index) => (
                <AnimatedCard
                  key={title}
                  index={index}
                  className="rounded-xl border border-brand-500/30 bg-[#F5EFE1] p-6 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-500/60 hover:shadow-md"
                >
                  <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-brand-500/20">
                    <Icon className="h-5 w-5 text-[#14241d]" />
                  </div>
                  <h3 className="mb-2 text-base font-semibold text-gray-900">{title}</h3>
                  <p className="text-sm text-gray-600 leading-relaxed">{body}</p>
                </AnimatedCard>
              ))}
            </div>
          </div>
        </section>

        {/* ── Grounding and safety — honest framing of what Layla won't say ─ */}
        <section className="bg-[#F5EFE1] bg-dot-grid px-6 py-20">
          <div className="mx-auto max-w-5xl">
            <AnimatedSection className="grid gap-10 lg:grid-cols-[1fr_1.2fr] lg:items-start">
              <div>
                <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-brand-500/15">
                  <ShieldCheck className="h-6 w-6 text-[#026B78]" />
                </div>
                <h2 className="text-3xl font-bold tracking-tight text-gray-900">
                  Trained on your clinic, not the internet
                </h2>
                <p className="mt-4 text-gray-500 leading-relaxed">
                  Layla is grounded in your service catalog, your provider hours, and an FAQ corpus you author —
                  she reads your entries verbatim, she doesn&apos;t paraphrase, and she refuses anything that
                  should come from a clinician.
                </p>
                <p className="mt-3 text-gray-500 leading-relaxed">
                  Vendor BAAs are available with Vapi, Twilio, Supabase, Stripe, and Resend. An in-app BAA
                  attestation is required before the voice agent will accept inbound or place outbound calls.
                  Data is encrypted at rest via Supabase/Postgres infrastructure.
                </p>
              </div>
              <ul className="space-y-3">
                {[
                  'Reads your FAQ entries word-for-word — never invents an answer',
                  'Verifies callers by caller-ID; won\'t accept a dictated phone number as identity',
                  'Declines to quote prices — that goes to your team',
                  'Declines post-care and medical advice — that\'s a clinician\'s call',
                  'Closed-enum dispositions tag every call: booked / rescheduled / canceled / message_taken / transferred / escalation_needed',
                  'PHI-scrubbed post-call summary emailed to the owner',
                ].map((line) => (
                  <li
                    key={line}
                    className="flex items-start gap-3 rounded-lg border border-gray-200 bg-[#FAF6EC] px-4 py-3"
                  >
                    <CheckCircle className="h-4 w-4 text-brand-500 mt-0.5 shrink-0" />
                    <span className="text-sm text-gray-700 leading-snug">{line}</span>
                  </li>
                ))}
              </ul>
            </AnimatedSection>
          </div>
        </section>

        {/* ── Tier ladder — explicit about what unlocks where ──── */}
        <section className="bg-[#FAF6EC] px-6 py-20">
          <div className="mx-auto max-w-6xl">
            <AnimatedSection className="mb-12 text-center">
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-gray-300 bg-[#F5EFE1] px-3 py-1">
                <Layers className="h-3.5 w-3.5 text-[#14241d]" />
                <span className="text-xs font-semibold uppercase tracking-wider text-[#14241d]">
                  Three tiers · Voice unlocks at Scale
                </span>
              </div>
              <h2 className="text-3xl font-bold tracking-tight text-gray-900">
                Pick the tier that matches how much you want automated
              </h2>
              <p className="mt-3 text-gray-500 max-w-2xl mx-auto">
                CRM at Starter. AI Twin SMS drafts + automations at Professional. Full Layla voice agent at Scale.
                Annual billing is 20% off. Switch tiers from the Billing Portal without a sales call.
              </p>
            </AnimatedSection>
            <div className="grid gap-5 sm:grid-cols-3">
              {TIERS.map(({ name, price, cap, includes, highlighted }, index) => (
                <AnimatedCard
                  key={name}
                  index={index}
                  className={`flex flex-col rounded-2xl border p-7 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${
                    highlighted
                      ? 'border-brand-500/60 bg-[#F5EFE1] ring-2 ring-brand-500/30'
                      : 'border-gray-200 bg-[#F5EFE1]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-gray-900">{name}</h3>
                    {highlighted && (
                      <span className="text-[10px] font-semibold uppercase tracking-wider rounded-full bg-brand-500/15 text-[#026B78] border border-brand-500/40 px-2 py-0.5">
                        Most picked
                      </span>
                    )}
                  </div>
                  <div className="mt-3 flex items-baseline gap-1">
                    <span className="text-3xl font-extrabold text-gray-900">{price}</span>
                    <span className="text-sm text-gray-500">/ mo</span>
                  </div>
                  <p className="mt-1 text-xs text-gray-500">{cap}</p>
                  <ul className="mt-5 space-y-2 flex-1">
                    {includes.map((item) => (
                      <li key={item} className="flex items-start gap-2 text-sm text-gray-700">
                        <CheckCircle className="h-4 w-4 text-brand-500 mt-0.5 shrink-0" />
                        <span className="leading-snug">{item}</span>
                      </li>
                    ))}
                  </ul>
                  <Link
                    href="/pricing"
                    className="mt-6 inline-flex items-center justify-center gap-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:border-gray-400 hover:text-gray-900 transition-colors"
                  >
                    See full pricing
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </AnimatedCard>
              ))}
            </div>
          </div>
        </section>

        {/* ── FAQ — rewritten for the new positioning ──────────── */}
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

        {/* ── Founder-led — kept on purpose, retuned for voice ──── */}
        <section className="bg-[#F5EFE1] px-6 py-16">
          <AnimatedSection className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-bold tracking-tight text-gray-900">
              Built with clinic owners, shipped by a founder
            </h2>
            <p className="mt-4 text-gray-500 leading-relaxed">
              Tarhunna is built by two founders in Frederick, Maryland who watched clinics lose
              thousands of dollars a month in calls nobody picked up. Layla is the answer to
              that, plus the CRM where every conversation she has actually lands.
            </p>
            <p className="mt-4 text-gray-500 leading-relaxed">
              Want to see Layla answer a test call on your own number? Book the demo — you&apos;ll
              talk to a founder, not a sales rep.
            </p>
            <div className="mt-8">
              <Link
                href="/book-demo"
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-brand px-6 py-3 text-base font-semibold text-white hover:scale-[1.02] transition-all duration-150 shadow-sm"
              >
                Book a 20-min demo
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </AnimatedSection>
        </section>

        {/* ── Final CTA ────────────────────────────────────────── */}
        <section className="bg-[#14241d] px-6 py-20">
          <AnimatedSection className="mx-auto max-w-2xl text-center">
            <LogoMark size="lg" standalone className="mb-3" />
            <h2 className="text-3xl font-bold tracking-tight text-[#F5EFE1] sm:text-4xl">
              Let Layla answer your next call
            </h2>
            <p className="mt-4 text-[#F5EFE1]/70">
              14-day free trial. No credit card required. Set up in less than 20 minutes.
            </p>
            <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <Link
                href="/signup"
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-brand px-6 py-3 text-base font-semibold text-white hover:scale-[1.02] transition-all duration-150 shadow-sm"
              >
                Start 14-day free trial
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/book-demo"
                className="w-full sm:w-auto inline-flex items-center justify-center rounded-lg border border-white/30 px-6 py-3 text-base font-semibold text-white hover:border-white/60 hover:bg-[#F5EFE1]/5 transition-colors"
              >
                Book a 20-min demo
              </Link>
            </div>
          </AnimatedSection>
        </section>

      </main>

      {/* ── Footer ───────────────────────────────────────────── */}
      <footer className="border-t border-gray-200 bg-[#F5EFE1] px-6 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 sm:flex-row">
          <div className="flex items-center gap-2.5">
            <LogoMark size="sm" standalone />
            <span className="text-sm text-gray-400">· AI receptionist + CRM for clinics</span>
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
