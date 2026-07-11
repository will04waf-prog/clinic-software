import type { Metadata } from 'next'
import Link from 'next/link'
import {
  Phone,
  PhoneIncoming,
  PhoneOutgoing,
  MessageSquare,
  CalendarDays,
  Languages,
  Inbox,
  Database,
  ShieldCheck,
  Users,
  CheckCircle,
  ArrowRight,
  Sparkles,
} from 'lucide-react'
import { ProductShowcase } from './product-showcase'
import { LogoMark } from '@/components/ui/logo-mark'
import { AnimatedSection } from '@/components/marketing/animated-section'
import { AnimatedCard } from '@/components/marketing/animated-card'
import { BilingualRoll } from '@/components/marketing/bilingual-roll'
import { HeroEcho } from '@/components/marketing/hero-echo'
import { LaylaDock } from '@/components/marketing/layla-dock'
import { AuroraDrift } from '@/components/marketing/aurora'

/* SEO landing for the "med spa CRM" search intent. The route stays at
   /med-spa-crm so Google keeps the keyword association, but the H1 and
   meta lead with the real product — an AI receptionist on top of a CRM
   foundation — because that's the wedge, not the CRM category. */
export const metadata: Metadata = {
  title: 'Med Spa CRM with an AI Receptionist Built In — Tarhunna',
  description:
    'Tarhunna is a med spa CRM with Layla, an AI voice receptionist that answers every call, books appointments live, and writes back to inbound texts in your voice. Capture every lead — even after hours.',
  keywords: [
    'med spa CRM',
    'CRM for med spas',
    'AI receptionist for med spas',
    'med spa AI voice agent',
    'med spa booking software',
    'med spa SMS automation',
    'med spa no-show reduction',
    'medical spa CRM',
    'med spa patient management',
    'med spa lead capture',
  ],
  alternates: {
    canonical: 'https://tarhunna.net/med-spa-crm',
  },
  openGraph: {
    type: 'website',
    siteName: 'Tarhunna',
    title: 'Med Spa CRM with an AI Receptionist Built In — Tarhunna',
    description:
      'An AI receptionist that answers every call, backed by a full med spa CRM. Layla books appointments live and texts the confirmation — so leads stop slipping while your front desk is on another call.',
    url: 'https://tarhunna.net/med-spa-crm',
    locale: 'en_US',
  },
}

// ── Tier helpers ──────────────────────────────────────────────
type Tier = 'starter' | 'professional' | 'scale' | 'any'

const TIER_LABEL: Record<Tier, string> = {
  starter: 'Starter and up',
  professional: 'Professional and up',
  scale: 'Scale',
  any: 'Every plan',
}

const TIER_STYLE: Record<Tier, string> = {
  starter:      'bg-brand-50  text-brand-700 ring-1 ring-brand-200/70',
  professional: 'bg-brand-100 text-brand-800 ring-1 ring-brand-300/70',
  scale:        'bg-[#14241d] text-[#F5EFE1] ring-1 ring-[#14241d]',
  any:          'bg-[#FAF6EC] text-brand-800 ring-1 ring-brand-200/60',
}

function TierBadge({ tier }: { tier: Tier }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${TIER_STYLE[tier]}`}
    >
      {TIER_LABEL[tier]}
    </span>
  )
}

// ── Page data ─────────────────────────────────────────────────

/* What Layla does on every call. Receptionist verbs, not feature names —
   these are the 16 voice tools rephrased the way an owner would describe
   their front desk if she never called in sick. */
const LAYLA_DOES = [
  'Answers the phone in your clinic\'s voice',
  'Answers and books in English or Spanish, following the caller\'s language',
  'Looks up your services and hours on her first turn',
  'Matches a treatment the caller asks for by name',
  'Finds 1-2 open slots on the line',
  'Holds the slot and confirms the booking verbally',
  'Confirms or reschedules existing appointments',
  'Cancels an appointment when the patient asks',
  'Looks up a caller\'s own appointment (caller-ID gated)',
  'Texts the booking, manage, intake, or directions link mid-call',
  'Reads back directions to your address',
  'Answers FAQs verbatim from your written corpus',
  'Reads pre-visit instructions for booked patients',
  'Takes a message when the question needs a human',
  'Transfers to a nominated team member on request',
  'Sends a PHI-scrubbed summary email after every call',
  'Declines pricing and medical questions politely',
]

const FEATURE_BLOCKS: Array<{
  icon: typeof Phone
  title: string
  oneLine: string
  body: string
  tier: Tier
}> = [
  {
    icon: PhoneIncoming,
    title: 'Layla answers the phone',
    oneLine:
      'An AI voice receptionist that picks up inbound calls 24/7 or after-hours, in your clinic\'s voice.',
    body:
      "Layla is a voice AI agent that answers your clinic's phone number and talks to callers like a trained front-desk hire. She greets, listens, asks the right intake questions, and resolves the call — or transfers to a human you nominate. Owners choose always-on or after-hours-only, and set a fallback number for anything Layla can't handle. Inbound calls cost you nothing if your team is already on another line.",
    tier: 'scale',
  },
  {
    icon: CalendarDays,
    title: 'She books appointments live, on the call',
    oneLine:
      'Layla checks real provider availability and confirms a slot before the caller hangs up.',
    body:
      'Layla reads your service catalog, your providers\' weekly hours, and date-specific overrides — then offers slots that actually exist. She holds the time, confirms it verbally, books the consultation in your calendar, and texts a confirmation. No "we\'ll call you back" loop, no double-booking, no slots invented out of thin air.',
    tier: 'scale',
  },
  {
    icon: Languages,
    title: 'She answers and books in English or Spanish',
    oneLine:
      'Layla detects the caller\'s language and stays in it — even if they switch mid-call.',
    body:
      'Layla greets, answers questions, and books consultations in natural, neutral Latin-American Spanish or English. She picks up the caller\'s language on her own turn and follows a caller who code-switches mid-call. Spanish-speaking patients get the same live booking, reminders, and CRM logging as English callers, on your clinic\'s own number.',
    tier: 'scale',
  },
  {
    icon: PhoneOutgoing,
    title: 'Outbound reminder calls that cut no-shows',
    oneLine:
      'Layla phones patients 4–72 hours before their visit so they can confirm, move, or cancel by voice.',
    body:
      'An hourly cron places outbound reminder calls into the day-before window you choose. Patients confirm, reschedule onto another open slot, cancel, or ask for a callback — entirely by voice. The result is fewer empty chairs without your team dialing through tomorrow\'s schedule by hand. Outbound reminders don\'t transfer to a live human, since the clinic may be closed.',
    tier: 'scale',
  },
  {
    icon: MessageSquare,
    title: 'AI Twin drafts every SMS reply in your voice',
    oneLine:
      'Inbound texts come back with a ready-to-send reply that already includes real open slots.',
    body:
      'Train a per-clinic writing profile once. After that, every inbound SMS gets an AI-drafted response in your tone, with genuinely available booking times pulled from your live calendar pasted into the body. On Professional you approve each send. On Scale, the AI Twin sends autonomously. Either way, you stop losing leads to the "we\'ll text you back tomorrow" gap.',
    tier: 'professional',
  },
  {
    icon: CalendarDays,
    title: 'Self-service booking and reschedules',
    oneLine:
      'A public booking page per clinic and signed SMS links that let patients move their own visit.',
    body:
      'Your /book/[slug] page lets new patients pick a service and a provider, see real availability, and confirm a hold. Existing patients get a /manage link via SMS so they can reschedule or cancel themselves — no email tag, no front-desk involvement. Confirmation SMS goes to the patient and a notification email to the owner.',
    tier: 'starter',
  },
  {
    icon: Inbox,
    title: 'Voice messages inbox + full call logs',
    oneLine:
      'Every call Layla can\'t resolve becomes a message in a real inbox, not a Post-it.',
    body:
      'When Layla takes a message, you get a PHI-scrubbed summary email and a row in /voice-messages with the linked call context. Every call she handles also writes a call_logs entry with transcript, disposition, duration, and recording URL — searchable, reviewable, and tied to the contact. Triage tomorrow morning from one screen instead of a voicemail box.',
    tier: 'scale',
  },
  {
    icon: ShieldCheck,
    title: 'Trained on your clinic, not the internet',
    oneLine:
      'Owner-authored FAQs Layla reads verbatim, caller-ID-gated lookups, no medical or pricing advice.',
    body:
      'You author your own FAQ corpus in Settings. Layla matches caller questions to your entries and reads them word for word — she doesn\'t paraphrase or invent. Appointment lookups, reschedules, and cancellations are gated on the caller\'s verified caller-ID, so a dictated phone number never overrides identity. She declines to quote prices, give post-care guidance, or anything that should come from a clinician.',
    tier: 'scale',
  },
  {
    icon: MessageSquare,
    title: 'Threaded two-way SMS on your number',
    oneLine:
      'Inbound replies land on the contact\'s timeline as a conversation, on the same phone number you already own.',
    body:
      'Send manual or AI-drafted SMS from a contact\'s page. Replies come back to the same thread, STOP/HELP keywords are honored automatically, and every message is logged to the activity timeline. No shared shortcode, no rebranded sender — just your clinic\'s number, two ways.',
    tier: 'starter',
  },
  {
    icon: Sparkles,
    title: 'Reminders that cut no-shows',
    oneLine:
      'Automated 24h and 2h consultation reminders by SMS and email, with editable per-clinic templates.',
    body:
      'Every booked consultation gets a confirmation, a 24-hour reminder, and a 2-hour reminder — SMS and email, with editable per-org templates and master toggles. On Scale, Layla adds day-before reminder calls patients can confirm or reschedule by voice. Set it once; every booking is covered.',
    tier: 'professional',
  },
  {
    icon: Database,
    title: 'The CRM underneath it all',
    oneLine:
      'Contacts, kanban pipeline, consultations calendar, tags, notes, activity timeline, and team seats.',
    body:
      'Every call Layla takes, every SMS the AI Twin sends, every booking from the public page lands in one contact record with a complete timeline. Drag consultations to reschedule them on the calendar. Tag and segment contacts. Invite staff with roles. Multi-tenant isolation is enforced at both the query layer and at Postgres RLS — your data stays your data.',
    tier: 'starter',
  },
  {
    icon: Sparkles,
    title: 'AI lead summary on every contact',
    oneLine:
      'Open a contact, see an AI-generated brief of their history before you call back.',
    body:
      'Each contact detail page surfaces a generated summary of the lead\'s history — source, stage, last touch, and what they\'ve asked for — so whoever picks up the file has context in five seconds, not five minutes. Available on every plan.',
    tier: 'starter',
  },
  {
    icon: CheckCircle,
    title: 'Stripe-billed trial, real super-admin, no surprises',
    oneLine:
      '14-day trial, Stripe Checkout + Billing Portal, monthly or annual, switch tiers without a sales call.',
    body:
      'Start the trial in under 20 minutes. Upgrade, downgrade, or cancel from the Billing Portal. Annual is 20% off. There\'s no per-seat surprise — seats are capped per tier (2 / 5 / unlimited) and shown on the pricing page. You always know what you\'ll be charged.',
    tier: 'any',
  },
]

/* Tier ladder card data — the third explicit "yes, the CRM is on every
   plan, voice unlocks at Scale" reassurance. Keeps the honesty guardrail
   that Layla is Scale-only and AI Twin SMS is Pro+. */
const TIERS = [
  {
    name: 'Starter',
    price: '$147',
    cap: '500 contacts · 2 seats',
    headline: 'The med spa CRM, end to end',
    includes: [
      'Contacts, kanban pipeline, consultations calendar',
      'Tags, notes, activity timeline, team management',
      'Public booking page + signed /manage reschedule links',
      "Two-way SMS threading on your clinic's phone number",
      'AI lead summary on every contact',
    ],
  },
  {
    name: 'Professional',
    price: '$297',
    cap: '2,500 contacts · 5 seats',
    headline: 'Everything in Starter, plus the texting half of the stack',
    includes: [
      'AI Twin drafts every inbound SMS reply for owner approval',
      'AI Twin drafts include real open booking slots from your calendar',
      '24h and 2h consultation reminder SMS and email',
      'Editable per-clinic reminder templates and toggles',
      'Bulk CSV import and AI Twin voice training',
    ],
    highlight: true,
  },
  {
    name: 'Scale',
    price: '$497',
    cap: 'Unlimited contacts · unlimited seats',
    headline: 'Layla, the AI voice receptionist',
    includes: [
      'Inbound voice agent — 24/7 or after-hours, your choice',
      'Books, reschedules, cancels live on the call',
      'Outbound AI reminder calls 4–72h ahead',
      'Voice messages inbox + searchable call transcripts',
      'AI Twin sends SMS replies autonomously',
    ],
  },
] as const

/* FAQ — rewritten for the new positioning. Honors search intent
   ("yes we are a CRM"), then escalates to the AI receptionist story.
   Schema.org FAQPage JSON-LD picks these up automatically. */
const FAQ_ITEMS = [
  {
    q: 'Is Tarhunna a CRM for med spas?',
    a: 'Yes. Tarhunna is a med spa CRM at its foundation — contacts, a kanban pipeline, a consultations calendar, tags, notes, an activity timeline, team seats with roles, and Postgres-level multi-tenant isolation. The CRM is on every plan. On top of that foundation, Professional adds AI-drafted SMS replies and automated consultation reminders, and Scale adds Layla, the AI voice receptionist that answers your phone.',
  },
  {
    q: 'What is the AI receptionist and which plan does it come with?',
    a: "Layla is an AI voice receptionist that answers your clinic's phone number. She greets callers in your clinic's voice, books appointments into real provider slots, reschedules or cancels existing visits, takes messages, transfers to a human you nominate, and follows up with PHI-scrubbed summary emails. Layla is on the Scale plan. The CRM is on every plan, and AI-drafted SMS replies are on Professional and Scale.",
  },
  {
    q: 'How does Layla actually book an appointment?',
    a: 'Layla reads your service catalog, your providers\' weekly hours, and any date-specific overrides through the same availability engine the public booking page uses. She offers slots that genuinely exist, holds the time during the call, verbally confirms it with the caller, books the consultation, and texts a confirmation. She does not invent times and she does not double-book.',
  },
  {
    q: 'Can Layla answer Spanish-speaking patients?',
    a: 'Yes. Layla answers and books in both English and Spanish, in a natural, neutral Latin-American Spanish. She detects the caller\'s language automatically and follows a caller who switches languages mid-call — with the same live booking, reminders, and CRM logging she gives every English call. For the DMV\'s large Spanish-speaking patient base, that means a receptionist who greets and books them natively, on your clinic\'s own number.',
  },
  {
    q: 'Will Layla call patients back to reduce no-shows?',
    a: 'Yes. An hourly cron places outbound AI reminder calls in the 4–72 hour window before each appointment. Patients confirm, reschedule onto another open slot, cancel, or request a callback — entirely by voice. Outbound reminder calls do not transfer to a live human, since the clinic may be closed when the call goes out.',
  },
  {
    q: 'What does AI Twin SMS do, and how is it different from Layla?',
    a: 'AI Twin handles texts. Every inbound SMS comes back with an AI-drafted reply in your clinic\'s writing voice, with real open slots from your live calendar pasted into the body. On Professional, you approve each send. On Scale, the AI Twin sends autonomously. Layla handles voice calls. Together they cover both halves of inbound communication.',
  },
  {
    q: 'Is Tarhunna HIPAA compliant?',
    a: 'Not yet — and we won\'t claim it before it\'s true. The platform is built HIPAA-ready: data encrypted at rest, tenant isolation enforced at the database layer, caller-ID-gated lookups so a dictated phone number is never accepted as identity, and an in-app BAA attestation required before the voice agent takes calls. Our formal compliance program — vendor agreements and written policies — is in progress. Talk to us and you\'ll get a straight answer on exactly where it stands.',
  },
  {
    q: 'Does Tarhunna integrate with my EMR or Google Calendar?',
    a: 'No. Tarhunna runs its own calendar, contact database, and SMS pipeline — it is intentionally not an EMR and does not currently sync with EMRs, Google Calendar, Outlook, or ad platforms. The trade-off is that Layla, the booking page, and your CRM all read from the same source of truth, so a slot offered on the phone is the same slot offered on the website.',
  },
  {
    q: 'How fast can I get set up?',
    a: '14-day free trial, no credit card. The CRM is usable inside 20 minutes. Connecting a phone number for SMS adds a few more, and provisioning Layla on the Scale plan is a guided setup that includes writing your FAQ corpus, choosing always-on or after-hours mode, and setting your transfer-to-human fallback.',
  },
  {
    q: 'What does it cost?',
    a: 'Starter is $147/mo (500 contacts, 2 seats) — the full CRM. Professional is $297/mo (2,500 contacts, 5 seats) — adds AI Twin SMS, automations, and bulk import. Scale is $497/mo (unlimited contacts and seats) — adds Layla, outbound reminder calls, and autonomous AI SMS. Annual billing is 20% off on all tiers.',
  },
]

// ── Page ──────────────────────────────────────────────────────

export default function MedSpaCRMPage() {
  return (
    <div className="flex min-h-screen flex-col bg-[#FAF6EC]">

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
            name: 'Med Spa CRM with an AI Receptionist Built In — Tarhunna',
            url: 'https://tarhunna.net/med-spa-crm',
            description:
              'A med spa CRM with Layla, an AI voice receptionist that answers every call and books appointments live. Backed by a full CRM, AI-drafted SMS replies, and automated consultation reminders.',
            isPartOf: { '@type': 'WebSite', name: 'Tarhunna', url: 'https://tarhunna.net' },
          }),
        }}
      />

      {/* ── Nav ──────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 border-b border-brand-900/10 bg-[#FAF6EC]/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <Link href="/" className="flex items-center gap-2.5">
            <LogoMark size="md" standalone />
          </Link>
          <nav className="flex items-center gap-3">
            <Link
              href="/login"
              className="text-sm font-medium text-brand-900/70 hover:text-brand-900 transition-colors"
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
        <section className="relative overflow-hidden bg-[#FAF6EC] px-6 py-20 sm:py-28">
          <div className="hero-glow" aria-hidden />
          <div className="relative mx-auto max-w-3xl text-center">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-brand-500/25 bg-brand-50 px-4 py-1.5">
              <Phone className="h-3.5 w-3.5 text-brand-700" aria-hidden />
              <span className="text-xs font-semibold uppercase tracking-wider text-brand-700">
                Med Spa CRM · AI Receptionist · 14-day free trial
              </span>
            </div>
            <h1 className="text-4xl font-extrabold tracking-tight text-brand-900 sm:text-5xl lg:text-6xl">
              {/* Echo scoped to the payoff word (period inside) so the
                  inline-block never distorts the H1's natural line wrap. */}
              An AI receptionist that actually books{' '}
              <HeroEcho>
                appointments<span className="text-brand-600">.</span>
              </HeroEcho>
            </h1>
            <p className="mt-4 text-base font-medium text-brand-700 sm:text-lg">
              Yes, it&apos;s a med spa CRM. The upgrade is who answers the phone.
            </p>
            <p className="mt-5 text-lg text-brand-900/70 sm:text-xl max-w-2xl mx-auto">
              Layla picks up the phone, books appointments, texts the link, and writes back to
              inbound SMS in your voice — so leads stop slipping while your front desk is on
              another call.
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
                className="w-full sm:w-auto inline-flex items-center justify-center rounded-lg border border-brand-900/15 bg-white px-6 py-3 text-base font-semibold text-brand-900 hover:border-brand-900/30 transition-colors"
              >
                Book a 20-min demo
              </Link>
            </div>
            <div className="mt-8 flex flex-col items-center gap-2 sm:flex-row sm:justify-center sm:gap-6">
              {['No credit card required', 'CRM live in under 20 minutes', 'Cancel anytime'].map((item) => (
                <div key={item} className="flex items-center gap-1.5 text-sm text-brand-900/60">
                  <CheckCircle className="h-4 w-4 text-brand-500 shrink-0" />
                  {item}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Layla dock — her pipeline at a glance ────────────── */}
        {/* Same decorative glass pill as the landing page, bridging the
            hero into the CRM-reassurance section. aria-hidden inside the
            component (it repeats adjacent copy). */}
        <div className="-mt-6 flex justify-center bg-[#FAF6EC] px-6 pb-10 sm:-mt-10">
          <LaylaDock />
        </div>

        {/* ── Yes-we-are-a-CRM reassurance ─────────────────────── */}
        {/* SEO intent honored explicitly before we escalate to voice.
            Visitor arrived searching "med spa CRM" — confirm it, then
            pivot to "and here is the upgrade you didn't know to ask for." */}
        <section className="bg-white px-6 py-16">
          <AnimatedSection className="mx-auto max-w-3xl text-center">
            <p className="text-xs font-semibold uppercase tracking-widest text-brand-600">
              You searched for a med spa CRM. We are one.
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-brand-900">
              The CRM is the foundation. The AI receptionist is the upgrade.
            </h2>
            <p className="mt-4 text-brand-900/70 max-w-2xl mx-auto">
              Contacts, pipeline, consultations calendar, tags, notes, activity timeline, two-way
              SMS, team seats — all of it is here on day one, on every plan. What makes Tarhunna
              different is what sits on top: a voice agent that answers your phone in your
              clinic&apos;s voice, books real slots live on the call, and texts the confirmation
              before the caller hangs up.
            </p>
            <div className="mt-8 grid gap-4 sm:grid-cols-3 text-left">
              <div className="rounded-xl bg-[#FAF6EC] border border-brand-200/50 p-5">
                <p className="text-xs font-semibold uppercase tracking-wider text-brand-700">CRM foundation</p>
                <p className="mt-2 text-sm text-brand-900/80">Every call, text, and booking lands on a single contact record with a complete timeline.</p>
              </div>
              <div className="rounded-xl bg-[#FAF6EC] border border-brand-200/50 p-5">
                <p className="text-xs font-semibold uppercase tracking-wider text-brand-700">AI Twin SMS</p>
                <p className="mt-2 text-sm text-brand-900/80">Inbound texts come back with a draft reply that already has real open slots pasted in.</p>
              </div>
              <div className="rounded-xl bg-[#14241d] text-[#F5EFE1] p-5">
                <p className="text-xs font-semibold uppercase tracking-wider text-brand-300">Layla, the AI receptionist</p>
                <p className="mt-2 text-sm text-[#F5EFE1]/85">Answers the phone, books appointments live, takes messages, transfers to a human on request.</p>
              </div>
            </div>
          </AnimatedSection>
        </section>

        {/* ── Product Showcase (visual scaffold kept as-is) ────── */}
        <ProductShowcase />

        {/* ── What Layla does on every call ────────────────────── */}
        <section className="bg-[#FAF6EC] px-6 py-20">
          <div className="mx-auto max-w-5xl">
            <AnimatedSection className="mb-10 text-center">
              <div className="inline-flex items-center gap-2">
                <TierBadge tier="scale" />
              </div>
              <h2 className="mt-4 text-3xl font-bold tracking-tight text-brand-900">
                What Layla does on every call
              </h2>
              <p className="mt-3 text-brand-900/70 max-w-2xl mx-auto">
                Sixteen voice tools, written the way an owner would describe their front desk if
                she never called in sick. No category nouns, just receptionist verbs.
              </p>
            </AnimatedSection>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {LAYLA_DOES.map((line, index) => (
                <AnimatedCard
                  key={line}
                  index={index}
                  className="flex items-start gap-3 rounded-xl border border-brand-200/60 bg-white px-5 py-4 shadow-sm"
                >
                  <CheckCircle className="h-4 w-4 text-brand-500 mt-0.5 shrink-0" />
                  <span className="text-sm text-brand-900/85 leading-snug">{line}</span>
                </AnimatedCard>
              ))}
            </div>
          </div>
        </section>

        {/* ── Feature blocks ───────────────────────────────────── */}
        <section className="bg-white px-6 py-20">
          <div className="mx-auto max-w-6xl">
            <AnimatedSection className="mb-12 text-center">
              <h2 className="text-3xl font-bold tracking-tight text-brand-900">
                Everything in the stack, with the tier it lives on
              </h2>
              <p className="mt-3 text-brand-900/70 max-w-xl mx-auto">
                The CRM is on every plan. Automations and AI Twin SMS unlock on Professional.
                Layla, the AI voice receptionist, is on Scale. Here is what each one actually does.
              </p>
            </AnimatedSection>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURE_BLOCKS.map(({ icon: Icon, title, oneLine, body, tier }, index) => (
                <AnimatedCard
                  key={title}
                  index={index}
                  className="flex flex-col gap-3 rounded-xl border border-brand-200/60 bg-[#FAF6EC] p-6 shadow-sm hover:-translate-y-0.5 hover:shadow-md transition-all duration-200"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-brand-500/10 ring-1 ring-brand-500/20">
                      <Icon className="h-5 w-5 text-brand-700" />
                    </div>
                    <TierBadge tier={tier} />
                  </div>
                  <h3 className="text-base font-semibold text-brand-900">{title}</h3>
                  <p className="text-sm font-medium text-brand-800/90 leading-snug">{oneLine}</p>
                  <p className="text-sm text-brand-900/70 leading-relaxed">{body}</p>
                  {title === 'She answers and books in English or Spanish' && (
                    <BilingualRoll layoutId="bilingual-roll-pill-medspa" />
                  )}
                </AnimatedCard>
              ))}
            </div>
          </div>
        </section>

        {/* ── Tier ladder ──────────────────────────────────────── */}
        {/* Explicit ladder so the "voice is Scale-only" guardrail is
            visible on the page, not buried on the pricing route. */}
        <section className="bg-[#FAF6EC] px-6 py-20">
          <div className="mx-auto max-w-5xl">
            <AnimatedSection className="mb-12 text-center">
              <h2 className="text-3xl font-bold tracking-tight text-brand-900">
                Three tiers. The CRM on every one. Voice unlocks at Scale.
              </h2>
              <p className="mt-3 text-brand-900/70 max-w-xl mx-auto">
                Annual billing is 20% off across the board. Seats are capped per tier and shown
                here so there are no per-seat surprises.
              </p>
            </AnimatedSection>
            <div className="grid gap-5 lg:grid-cols-3">
              {TIERS.map((tier) => (
                <div
                  key={tier.name}
                  className={[
                    'flex flex-col gap-4 rounded-2xl p-6 shadow-sm',
                    tier.name === 'Scale'
                      ? 'bg-[#14241d] text-[#F5EFE1] ring-1 ring-[#14241d]'
                      : tier.name === 'Professional'
                        ? 'bg-white ring-2 ring-brand-500/60'
                        : 'bg-white ring-1 ring-brand-200/60',
                  ].join(' ')}
                >
                  <div className="flex items-baseline justify-between">
                    <h3 className={`text-xl font-bold ${tier.name === 'Scale' ? 'text-[#F5EFE1]' : 'text-brand-900'}`}>
                      {tier.name}
                    </h3>
                    {'highlight' in tier && tier.highlight ? (
                      <span className="inline-flex items-center rounded-full bg-brand-500/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-brand-700 ring-1 ring-brand-300/60">
                        Most popular
                      </span>
                    ) : null}
                  </div>
                  <div>
                    <span className={`text-3xl font-extrabold ${tier.name === 'Scale' ? 'text-[#F5EFE1]' : 'text-brand-900'}`}>
                      {tier.price}
                    </span>
                    <span className={tier.name === 'Scale' ? 'text-[#F5EFE1]/70' : 'text-brand-900/60'}>
                      {' '}/ month
                    </span>
                  </div>
                  <p className={`text-xs font-semibold uppercase tracking-wider ${tier.name === 'Scale' ? 'text-brand-300' : 'text-brand-700'}`}>
                    {tier.cap}
                  </p>
                  <p className={`text-sm font-medium ${tier.name === 'Scale' ? 'text-[#F5EFE1]/90' : 'text-brand-900/85'}`}>
                    {tier.headline}
                  </p>
                  <ul className="space-y-2">
                    {tier.includes.map((line) => (
                      <li key={line} className="flex items-start gap-2 text-sm">
                        <CheckCircle
                          className={`h-4 w-4 mt-0.5 shrink-0 ${
                            tier.name === 'Scale' ? 'text-brand-400' : 'text-brand-500'
                          }`}
                        />
                        <span className={tier.name === 'Scale' ? 'text-[#F5EFE1]/85' : 'text-brand-900/75'}>
                          {line}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <p className="mt-6 text-center text-xs text-brand-900/55">
              Business Associate Agreements in place with every infrastructure provider behind the platform. In-app BAA
              attestation required before Layla accepts inbound or places outbound calls.
            </p>
          </div>
        </section>

        {/* ── Grounding & safety ──────────────────────────────── */}
        <section className="bg-white px-6 py-20">
          <AnimatedSection className="mx-auto max-w-3xl">
            <div className="mb-8 text-center">
              <h2 className="text-3xl font-bold tracking-tight text-brand-900">
                Trained on your clinic, not the internet
              </h2>
              <p className="mt-3 text-brand-900/70 max-w-2xl mx-auto">
                Honest framing of what Layla will and won&apos;t say — and how she stays grounded
                in your data.
              </p>
            </div>
            <ul className="space-y-3">
              {[
                'Owner-authored FAQ corpus. Layla matches caller questions to your entries and reads them word for word. She does not paraphrase or invent.',
                'Appointment lookups, reschedules, and cancellations are gated on the caller\'s verified caller-ID. A dictated phone number never overrides identity.',
                'She declines to quote prices, give post-care guidance, or anything that should come from a clinician — and routes those questions to a human you nominate.',
                'Encrypted at rest via Supabase/Postgres infrastructure. Multi-tenant isolation enforced at both the query layer and Postgres RLS.',
                'Closed-enum dispositions tag every call: booked, rescheduled, canceled, info_only, message_taken, transferred, abandoned, escalation_needed.',
              ].map((line) => (
                <li
                  key={line}
                  className="flex items-start gap-3 rounded-xl border border-brand-200/60 bg-[#FAF6EC] px-5 py-4"
                >
                  <ShieldCheck className="h-4 w-4 text-brand-700 mt-0.5 shrink-0" />
                  <span className="text-sm text-brand-900/85">{line}</span>
                </li>
              ))}
            </ul>
          </AnimatedSection>
        </section>

        {/* ── Mid-page CTA ─────────────────────────────────────── */}
        <section className="bg-[#14241d] px-6 py-12">
          <AnimatedSection className="mx-auto max-w-3xl flex flex-col items-center gap-4 text-center sm:flex-row sm:justify-between sm:text-left">
            <div>
              <p className="text-base font-semibold text-[#F5EFE1]">
                Let Layla answer your next call.
              </p>
              <p className="mt-1 text-sm text-[#F5EFE1]/75">
                14-day trial. Founder-led setup. No credit card required.
              </p>
            </div>
            <div className="flex flex-col items-center gap-2 sm:flex-row sm:shrink-0">
              <Link
                href="/signup"
                className="inline-flex items-center gap-2 rounded-lg bg-gradient-brand px-5 py-2.5 text-sm font-semibold text-white hover:scale-[1.02] transition-all duration-150 shadow-sm"
              >
                Start 14-day free trial
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
              <Link
                href="/book-demo"
                className="text-sm font-medium text-[#F5EFE1]/80 hover:text-[#F5EFE1] transition-colors"
              >
                or book a 20-min demo
              </Link>
            </div>
          </AnimatedSection>
        </section>

        {/* ── Founder block ────────────────────────────────────── */}
        <section className="bg-[#FAF6EC] px-6 py-20">
          <AnimatedSection className="mx-auto max-w-3xl text-center">
            <div className="inline-flex items-center gap-2 rounded-full bg-brand-50 border border-brand-200/60 px-3 py-1">
              <Users className="h-3.5 w-3.5 text-brand-700" aria-hidden />
              <span className="text-xs font-semibold uppercase tracking-wider text-brand-700">
                Built with clinic owners, shipped by a founder
              </span>
            </div>
            <h2 className="mt-5 text-3xl font-bold tracking-tight text-brand-900">
              Talk to a founder, not a sales rep
            </h2>
            <p className="mt-4 text-brand-900/70">
              Every feature on this page was scoped against a real med spa front desk. When you
              book a demo, you talk to the person who decides what ships next — and your feedback
              goes into the roadmap, not a queue.
            </p>
          </AnimatedSection>
        </section>

        {/* ── FAQ ──────────────────────────────────────────────── */}
        <section className="bg-white px-6 py-20">
          <AnimatedSection className="mx-auto max-w-3xl">
            <div className="mb-12 text-center">
              <h2 className="text-3xl font-bold tracking-tight text-brand-900">
                Frequently asked questions
              </h2>
              <p className="mt-3 text-brand-900/65">
                Honest answers about the CRM, Layla, AI Twin SMS, and what each tier actually includes.
              </p>
            </div>
            <dl className="divide-y divide-brand-200/60 rounded-xl border border-brand-200/60 bg-[#FAF6EC] overflow-hidden shadow-sm">
              {FAQ_ITEMS.map(({ q, a }) => (
                <div key={q} className="px-6 py-5">
                  <dt className="mb-2 text-sm font-semibold text-brand-900">{q}</dt>
                  <dd className="text-sm text-brand-900/70 leading-relaxed">{a}</dd>
                </div>
              ))}
            </dl>
          </AnimatedSection>
        </section>

        {/* ── Final CTA ────────────────────────────────────────── */}
        <section className="relative overflow-hidden bg-[#14241d] px-6 py-20">
          <AuroraDrift />
          <AnimatedSection className="relative z-10 mx-auto max-w-2xl text-center">
            <LogoMark size="lg" standalone className="mb-3" />
            <h2 className="text-3xl font-bold tracking-tight text-[#F5EFE1] sm:text-4xl">
              Let Layla answer your next call
            </h2>
            <p className="mt-4 text-[#F5EFE1]/80 text-base">
              An AI receptionist that answers every call, backed by a full CRM.
            </p>
            <p className="mt-2 text-[#F5EFE1]/55 text-sm">
              14-day free trial. No credit card required. CRM live in under 20 minutes.
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
                className="w-full sm:w-auto inline-flex items-center justify-center rounded-lg border border-[#F5EFE1]/30 px-6 py-3 text-base font-semibold text-[#F5EFE1] hover:border-[#F5EFE1]/60 hover:bg-white/5 transition-colors"
              >
                Book a 20-min demo
              </Link>
            </div>
          </AnimatedSection>
        </section>

      </main>

      {/* ── Footer ───────────────────────────────────────────── */}
      <footer className="border-t border-brand-900/10 bg-[#FAF6EC] px-6 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 sm:flex-row">
          <div className="flex items-center gap-2.5">
            <LogoMark size="sm" standalone />
            <span className="text-sm text-brand-900/55">· AI receptionist + CRM for aesthetic clinics</span>
          </div>
          <div className="flex items-center gap-5 text-sm text-brand-900/65">
            <Link href="/" className="hover:text-brand-900 transition-colors">Home</Link>
            <Link href="/privacy" className="hover:text-brand-900 transition-colors">Privacy</Link>
            <Link href="/terms" className="hover:text-brand-900 transition-colors">Terms</Link>
            <Link href="/login" className="hover:text-brand-900 transition-colors">Log in</Link>
            <Link href="/signup" className="hover:text-brand-900 transition-colors">Sign up</Link>
            <span>© {new Date().getFullYear()} Tarhunna</span>
          </div>
        </div>
      </footer>

    </div>
  )
}
