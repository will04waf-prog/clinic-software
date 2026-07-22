'use client'

import { useState } from 'react'
import type { CSSProperties } from 'react'
import Link from 'next/link'
import {
  UserPlus, FileText, MessageCircle, CheckCircle2, CalendarDays, CreditCard,
  ArrowRight, Sprout, Sparkles, Leaf, Brush, HardHat, Phone, Check, ShieldCheck, Camera, Repeat,
} from 'lucide-react'
import { LogoMark } from '@/components/ui/logo-mark'
import { SignatureLogo } from '@/components/ui/signature-logo'
import { AnimatedSection } from '@/components/marketing/animated-section'
import { DepthParallax } from '@/components/marketing/depth-parallax'

type Locale = 'es' | 'en'
type Variant = 'default' | 'trades' | 'limpieza' | 'construccion'

// Approved loop-first copy (founder-approved 2026-07-12). Spanish is the
// segment's language; the noun is 'estimado' (not 'presupuesto').
const COPY = {
  es: {
    skip: 'Saltar al contenido',
    switch: 'English',
    eyebrow: 'El CRM en español para su negocio',
    h1: 'Mande el estimado hoy. Cobre esta semana.',
    sub: 'Cree un estimado en 2 minutos, mándelo por WhatsApp, y su cliente lo aprueba con un toque. Se convierte en un trabajo en su agenda — y usted cobra con tarjeta, o marca el efectivo o Zelle. Todo desde el teléfono, todo en español.',
    hook: 'Cada estimado que no manda hoy es un trabajo que otro agenda mañana.',
    ctaPrimary: 'Empezar gratis',
    ctaSecondary: 'Ver cómo funciona',
    chips: ['Sin tarjeta de crédito', 'En español', 'Desde su teléfono'],
    loopTitle: 'Su negocio, en seis pasos',
    loop: [
      { t: 'Cliente', d: 'nombre + celular', icon: UserPlus },
      { t: 'Estimado', d: 'en 2 minutos', icon: FileText },
      { t: 'WhatsApp', d: 'se lo manda', icon: MessageCircle },
      { t: 'Aprobado', d: 'con un toque', icon: CheckCircle2 },
      { t: 'Trabajo', d: 'en su agenda', icon: CalendarDays },
      { t: 'Cobrado', d: 'tarjeta o efectivo', icon: CreditCard },
    ],
    // Annotation cards on the loop showcase (desktop only, decorative;
    // composed strictly from the approved loop vocabulary above).
    annoSent: 'Enviado por WhatsApp',
    annoSentSub: 'estimado en 2 minutos',
    annoApproved: 'Aprobado con un toque',
    annoApprovedSub: 'queda en su agenda',
    featTitle: 'Qué hace',
    features: [
      { h: 'Estimados en 2 minutos', b: 'Sus servicios y precios, desde el teléfono, entre un trabajo y otro. Se ve profesional — sin papeleo.', icon: FileText },
      { h: 'Se lo manda por WhatsApp', b: 'Su cliente lo recibe donde ya está. Lo abre y lo aprueba con un toque — sin apps ni cuentas.', icon: MessageCircle },
      { h: 'Se vuelve un trabajo', b: 'Al aprobar, el estimado entra en su agenda. Nada se pierde en un papel ni en la memoria.', icon: CalendarDays },
      { h: 'Cobre como quiera', b: 'Con tarjeta dentro de la app, o marque el efectivo o Zelle. Usted decide; el dinero llega.', icon: CreditCard },
      { h: 'Trabajos que se repiten', b: 'Semanal, quincenal o mensual: al completar un trabajo, el siguiente se crea solo en su agenda.', icon: Repeat },
    ],
    proofTitle: 'Si un cliente reclama, usted tiene pruebas',
    proofSub: 'Las dos quejas que más le cuestan a un jardinero: «yo nunca aprobé eso» y «a mí no me hicieron el trabajo». Tarhunna le deja constancia de las dos.',
    proofApprovalTitle: 'Aprobación con un toque',
    proofApprovalBody: 'Queda constancia de lo que el cliente aprobó: quién, qué día y a qué hora. Si después reclama, usted tiene el registro.',
    proofApprovalExample: 'Aprobado por María · 14 de julio, 3:42 pm',
    proofPhotoTitle: 'Foto del trabajo terminado',
    proofPhotoBody: 'Su cliente ve la foto del trabajo terminado junto con su recibo. Nadie puede decir que no se hizo.',
    trustTitle: 'Trato justo, siempre',
    trustItems: ['Sin contratos', 'Cancele desde la app cuando quiera', 'Sin tarjeta para empezar la prueba'],
    trustKiller: 'No guardamos su tarjeta durante la prueba — así que es imposible que le cobremos por sorpresa.',
    bridgeTitle: 'Habla los dos idiomas',
    bridge: 'Usted trabaja en español. Sus clientes a veces llaman en inglés. Tarhunna habla los dos — sus estimados, sus mensajes y su panel, en el idioma de cada quien.',
    forWhoTitle: 'Para quién',
    forWho: 'Hecho para negocios que trabajan con las manos.',
    industries: [
      { label: 'Jardinería y paisajismo', icon: Leaf },
      { label: 'Limpieza', icon: Brush },
      { label: 'Construcción y oficios', icon: HardHat },
    ],
    soon: 'más — próximamente',
    priceTitle: 'Un solo plan, sin sorpresas',
    priceAmount: '$39',
    priceUnit: '/mes',
    priceBullets: [
      '14 días gratis',
      'Sin tarjeta para empezar',
      'Tarjeta: 3.9% + 30¢ — solo si cobra con tarjeta',
      'Zelle y efectivo: siempre gratis',
    ],
    priceLockIn: 'Cancele cuando quiera. Sin contratos. Sin sorpresas.',
    priceCta: 'Empezar gratis',
    laylaTitle: 'Layla, un complemento opcional',
    layla: '¿Le suena el teléfono todo el día? Layla, la recepcionista con IA, contesta y agenda por usted — en inglés y español — cuando usted no puede.',
    laylaCall: 'Llámela ahora y escúchela',
    laylaCta: 'Conocer a Layla',
    closeTitle: 'Empiece gratis hoy.',
    closeSub: 'Sin tarjeta. Configúrelo en minutos, desde el teléfono.',
    closeCta: 'Crear mi cuenta',
    footer: 'El CRM en español para negocios de servicios.',
  },
  en: {
    skip: 'Skip to content',
    switch: 'Español',
    eyebrow: 'The Spanish CRM for your business',
    h1: 'Send the estimate today. Get paid this week.',
    sub: 'Build an estimate in 2 minutes, send it by WhatsApp, and your client approves it with one tap. It becomes a job on your schedule — and you get paid by card, or mark it cash or Zelle. All from your phone, all in Spanish.',
    hook: 'Every estimate you don’t send today is a job someone else books tomorrow.',
    ctaPrimary: 'Start free',
    ctaSecondary: 'See how it works',
    chips: ['No credit card', 'In Spanish', 'From your phone'],
    loopTitle: 'Your business, in six steps',
    loop: [
      { t: 'Client', d: 'name + cell', icon: UserPlus },
      { t: 'Estimate', d: 'in 2 minutes', icon: FileText },
      { t: 'WhatsApp', d: 'send it', icon: MessageCircle },
      { t: 'Approved', d: 'one tap', icon: CheckCircle2 },
      { t: 'Job', d: 'on your schedule', icon: CalendarDays },
      { t: 'Paid', d: 'card or cash', icon: CreditCard },
    ],
    annoSent: 'Sent by WhatsApp',
    annoSentSub: 'estimate in 2 minutes',
    annoApproved: 'Approved in one tap',
    annoApprovedSub: 'lands on your schedule',
    featTitle: 'What it does',
    features: [
      { h: 'Estimates in 2 minutes', b: 'Your services and prices, from your phone, between jobs. Looks professional — no paperwork.', icon: FileText },
      { h: 'Send it by WhatsApp', b: 'Your client gets it where they already are. They open it and approve in one tap — no apps, no accounts.', icon: MessageCircle },
      { h: 'It becomes a job', b: 'On approval, the estimate lands on your schedule. Nothing lost on paper or in someone’s memory.', icon: CalendarDays },
      { h: 'Get paid your way', b: 'By card in the app, or mark it cash or Zelle. You choose; the money lands.', icon: CreditCard },
      { h: 'Repeating jobs', b: 'Weekly, biweekly, or monthly: complete a job and the next one is created on your schedule automatically.', icon: Repeat },
    ],
    proofTitle: 'If a client pushes back, you have proof',
    proofSub: 'The two claims that cost service businesses the most: “I never approved that” and “the work was never done.” Tarhunna keeps a record of both.',
    proofApprovalTitle: 'One-tap approval',
    proofApprovalBody: 'A record of exactly what the client approved: who, what day, what time. If they push back later, you have the receipt.',
    proofApprovalExample: 'Approved by María · July 14, 3:42 pm',
    proofPhotoTitle: 'Completed-work photo',
    proofPhotoBody: 'Your client sees the photo of the finished work right next to their receipt. No one can say it wasn’t done.',
    trustTitle: 'Fair terms, always',
    trustItems: ['No contracts', 'Cancel from the app anytime', 'No card to start the trial'],
    trustKiller: 'We don’t store your card during the trial — so a surprise charge is impossible.',
    bridgeTitle: 'Speaks both languages',
    bridge: 'You work in Spanish. Your customers sometimes call in English. Tarhunna speaks both — your estimates, messages, and dashboard, each in the right language.',
    forWhoTitle: 'Who it’s for',
    forWho: 'Built for businesses that work with their hands.',
    industries: [
      { label: 'Landscaping & lawn care', icon: Leaf },
      { label: 'Cleaning', icon: Brush },
      { label: 'Construction & trades', icon: HardHat },
    ],
    soon: 'more — soon',
    priceTitle: 'One plan, no surprises',
    priceAmount: '$39',
    priceUnit: '/mo',
    priceBullets: [
      '14 days free',
      'No card to start',
      'Card: 3.9% + 30¢ — only when you charge by card',
      'Zelle and cash: always free',
    ],
    priceLockIn: 'Cancel anytime. No contracts. No surprises.',
    priceCta: 'Start free',
    laylaTitle: 'Layla, an optional add-on',
    layla: 'Phone ringing all day? Layla, the AI receptionist, answers and books for you — in English and Spanish — when you can’t.',
    laylaCall: 'Call now and hear her',
    laylaCta: 'Meet Layla',
    closeTitle: 'Start free today.',
    closeSub: 'No card. Set it up in minutes, from your phone.',
    closeCta: 'Create my account',
    footer: 'The Spanish CRM for service businesses.',
  },
} as const

// The /trades variant leads in English with the Spanish-customer hook.
const TRADES_HOOK = {
  h1: 'Quote it, send it, get paid.',
  sub: 'Build an estimate in 2 minutes and send it by WhatsApp — your customer approves with one tap, and it becomes a scheduled job you get paid for. And half your customers speak Spanish. Tarhunna handles both.',
}

// The /limpieza variant speaks to cleaning owners (Spanish-first).
// Recurring visits + the Google-review ask are THE hooks for this
// segment; the proof line swaps the landscaping complaint framing for
// the cleaning one.
const LIMPIEZA_HOOK = {
  es: {
    h1: 'Sus limpiezas, sus clientas y sus pagos — todo por WhatsApp.',
    sub: 'Mande el estimado por WhatsApp y su clienta lo aprueba con un toque. La limpieza queda en su agenda — la semanal se repite sola — y al terminar, el sistema le pide la reseña de Google por usted.',
    proofSub: 'Las dos quejas que más le cuestan a un negocio de limpieza: «yo nunca aprobé ese precio» y «no quedó bien limpio». Tarhunna le deja constancia de las dos.',
  },
  en: {
    h1: 'Your cleanings, clients, and payments — all on WhatsApp.',
    sub: 'Send the estimate on WhatsApp and your client approves with one tap. The cleaning lands on your schedule — weeklies repeat on their own — and when you finish, we ask for the Google review for you.',
    proofSub: 'The two claims that cost a cleaning business the most: “I never approved that price” and “it wasn’t cleaned right.” Tarhunna keeps a record of both.',
  },
} as const

// The /construccion variant leads with THE contractor pain: the verbal
// change order ("eso yo nunca lo aprobé"). One-tap written approval is
// the product's sharpest fit for this trade.
const CONSTRUCCION_HOOK = {
  es: {
    h1: 'Cada trabajo y cada extra, aprobado por escrito — con un toque.',
    sub: 'Mande el estimado por WhatsApp y su cliente lo aprueba con un toque: queda constancia de quién aprobó qué, con fecha y hora. Los extras y cambios también por escrito. Y usted cobra — con tarjeta, efectivo o Zelle.',
    proofSub: 'Las dos quejas que más le cuestan a un contratista: «yo nunca aprobé ese extra» y «eso no quedó como lo pedí». Tarhunna le deja constancia de las dos.',
  },
  en: {
    h1: 'Every job and every change order, approved in writing — one tap.',
    sub: 'Send the estimate by WhatsApp and your client approves with one tap: a record of who approved what, with date and time. Extras and changes in writing too. And you get paid — card, cash, or Zelle.',
    proofSub: 'The two claims that cost a contractor the most: “I never approved that extra” and “that\'s not what I asked for.” Tarhunna keeps a record of both.',
  },
} as const

const VERTICAL_HOOKS = { limpieza: LIMPIEZA_HOOK, construccion: CONSTRUCCION_HOOK } as const

export function LoopLanding({ defaultLocale = 'es', variant = 'default' }: { defaultLocale?: Locale; variant?: Variant }) {
  const [locale, setLocale] = useState<Locale>(defaultLocale)
  const t = COPY[locale]
  const hook = variant === 'limpieza' || variant === 'construccion' ? VERTICAL_HOOKS[variant][locale] : null
  const h1 = hook?.h1 ?? (variant === 'trades' && locale === 'en' ? TRADES_HOOK.h1 : t.h1)
  const sub = hook?.sub ?? (variant === 'trades' && locale === 'en' ? TRADES_HOOK.sub : t.sub)
  const proofSub = hook?.proofSub ?? t.proofSub
  // Per-vertical funnel: the signup page reads ?v= to set the org's vertical.
  const signupHref =
    variant === 'limpieza' ? '/signup?v=limpieza'
    : variant === 'construccion' ? '/signup?v=construccion'
    : '/signup'

  return (
    <div className="min-h-screen bg-[#F5EFE1] text-gray-900">
      {/* Keyboard/screen-reader skip link — first focusable element. */}
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-[#028090] focus:shadow-lg focus:ring-2 focus:ring-[#028090]"
      >
        {t.skip}
      </a>
      {/* Top bar */}
      <header className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4">
        <LogoMark size="md" standalone priority />
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setLocale((l) => (l === 'es' ? 'en' : 'es'))}
            className="rounded-full border border-[#028090]/30 px-3 py-1 text-xs font-semibold text-[#028090] hover:bg-[#028090]/10"
          >
            {t.switch}
          </button>
          <Link href={signupHref} className="rounded-full bg-[#028090] px-4 py-1.5 text-sm font-semibold text-white hover:bg-[#026B78]">
            {t.ctaPrimary}
          </Link>
        </div>
      </header>

      <main id="contenido" tabIndex={-1}>
      {/* Hero */}
      <section className="mx-auto max-w-3xl px-5 pt-6 pb-4 text-center">
        <SignatureLogo size="xl" variant="light-bg" animated className="mb-3 block" />
        <p className="text-xs font-semibold uppercase tracking-widest text-[#028090]">{t.eyebrow}</p>
        <h1 className="mx-auto mt-3 max-w-2xl text-4xl font-extrabold leading-[1.08] tracking-tight sm:text-5xl text-balance">{h1}</h1>
        <p className="mx-auto mt-5 max-w-xl text-lg text-gray-600">{sub}</p>
        <p className="mx-auto mt-4 max-w-lg text-sm text-gray-400">{t.hook}</p>
        <div className="mt-7 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <Link href={signupHref} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-brand px-6 py-3.5 text-base font-semibold text-white active:scale-[.99] transition-transform sm:w-auto">
            {t.ctaPrimary} <ArrowRight className="h-4 w-4" />
          </Link>
          <a href="#como" className="inline-flex w-full items-center justify-center rounded-xl border border-gray-300 bg-[#F5EFE1] px-6 py-3.5 text-base font-semibold text-gray-700 hover:border-gray-400 sm:w-auto">
            {t.ctaSecondary}
          </a>
        </div>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
          {t.chips.map((c) => (
            <span key={c} className="inline-flex items-center gap-1.5 text-sm text-gray-500">
              <CheckCircle2 className="h-4 w-4 text-[#02C39A]" /> {c}
            </span>
          ))}
        </div>
      </section>

      {/* Loop strip — the product showcase. Depth parallax (drifts a
          few % slower than scroll on fine pointers) + two tilted
          floating annotation cards overlapping the frame corners on
          desktop, same language as the division sites' stages. */}
      <section id="como" className="mx-auto max-w-3xl px-5 py-10 scroll-mt-6">
        <h2 className="mb-4 text-center text-sm font-semibold uppercase tracking-wider text-gray-500">{t.loopTitle}</h2>
        <DepthParallax factor={0.05}>
          <div className="relative">
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {t.loop.map(({ t: label, d, icon: Icon }, i) => (
                <div key={label} className="flex items-center gap-2.5 rounded-xl border-l-[3px] border-[#028090] border border-gray-200 bg-white px-3 py-3 shadow-sm">
                  <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#02C39A]/15 text-[#028090]">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[10px] font-mono text-gray-400">{String(i + 1).padStart(2, '0')}</span>
                    <span className="block text-sm font-bold leading-tight">{label}</span>
                    <span className="block text-[11px] text-gray-500 leading-tight">{d}</span>
                  </span>
                </div>
              ))}
            </div>
            {/* Annotation cards — decorative, desktop only, never
                intercept clicks. Transform nesting: .anno-card
                (position) → AnimatedSection (reveal) → .tilt (rotate)
                → .float (gentle phased float). */}
            <div
              aria-hidden="true"
              className="anno-card hidden lg:block -top-9 -left-14"
              style={{ '--tilt': '-7deg', '--float-dur': '5.2s' } as CSSProperties}
            >
              <AnimatedSection delay={0.15}>
                <div className="tilt">
                  <div className="float">
                    <div className="w-48 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-lg">
                      <p className="text-[13px] font-semibold text-gray-900">
                        <span className="text-[#02C39A]">●</span> {t.annoSent}
                      </p>
                      <p className="mt-0.5 text-[11px] text-gray-500">{t.annoSentSub}</p>
                    </div>
                  </div>
                </div>
              </AnimatedSection>
            </div>
            <div
              aria-hidden="true"
              className="anno-card hidden lg:block -bottom-12 -right-24"
              style={{ '--tilt': '8deg', '--float-dur': '6s', '--float-phase': '-2.1s' } as CSSProperties}
            >
              <AnimatedSection delay={0.25}>
                <div className="tilt">
                  <div className="float">
                    <div className="w-48 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-lg">
                      <p className="text-[13px] font-semibold text-gray-900">
                        <span className="text-[#02C39A]">✓</span> {t.annoApproved}
                      </p>
                      <p className="mt-0.5 text-[11px] text-gray-500">{t.annoApprovedSub}</p>
                    </div>
                  </div>
                </div>
              </AnimatedSection>
            </div>
          </div>
        </DepthParallax>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-3xl px-5 py-6">
        <h2 className="mb-5 text-2xl font-bold tracking-tight">{t.featTitle}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {t.features.map(({ h, b, icon: Icon }) => (
            <div key={h} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[#02C39A]/15 text-[#028090]"><Icon className="h-5 w-5" /></span>
              <h3 className="mt-3 font-semibold text-gray-900">{h}</h3>
              <p className="mt-1 text-sm text-gray-600 leading-relaxed">{b}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Proof / dispute protection — the market wound this product heals.
          Framed as protection, not paperwork. */}
      <section className="mx-auto max-w-3xl px-5 py-10">
        <h2 className="text-2xl font-bold tracking-tight text-balance">{t.proofTitle}</h2>
        <p className="mt-2 max-w-xl text-gray-600">{proofSub}</p>
        <DepthParallax factor={0.04} className="mt-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-[#02C39A]/30 bg-white p-5 shadow-sm">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[#02C39A]/15 text-[#0B7A5E]"><ShieldCheck className="h-5 w-5" /></span>
            <h3 className="mt-3 font-semibold text-gray-900">{t.proofApprovalTitle}</h3>
            <p className="mt-1 text-sm text-gray-600 leading-relaxed">{t.proofApprovalBody}</p>
            {/* A miniature of the real approval badge the owner gets. */}
            <p className="mt-3 inline-flex items-start gap-1.5 rounded-lg border border-[#02C39A]/25 bg-[#02C39A]/10 px-2.5 py-1.5 text-[12px] font-semibold text-[#0B7A5E]">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {t.proofApprovalExample}
            </p>
          </div>
          <div className="rounded-2xl border border-[#02C39A]/30 bg-white p-5 shadow-sm">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[#02C39A]/15 text-[#0B7A5E]"><Camera className="h-5 w-5" /></span>
            <h3 className="mt-3 font-semibold text-gray-900">{t.proofPhotoTitle}</h3>
            <p className="mt-1 text-sm text-gray-600 leading-relaxed">{t.proofPhotoBody}</p>
          </div>
        </div>
        </DepthParallax>
      </section>

      {/* scene-cut: cream → ink */}
      <div className="scene-cut cut-cream-ink" aria-hidden="true" />

      {/* Bilingual bridge — dark band, with the family film grain */}
      <section className="relative overflow-hidden bg-[#0B2027] px-5 py-14 text-[#F5EFE1]">
        <div className="mx-auto max-w-2xl text-center">
          <Sparkles className="mx-auto h-6 w-6 text-[#02C39A]" />
          <h2 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl text-balance">{t.bridgeTitle}</h2>
          <p className="mx-auto mt-4 max-w-lg text-[#F5EFE1]/75">{t.bridge}</p>
        </div>
        <div className="film-grain" aria-hidden="true" />
      </section>

      {/* scene-cut: ink → cream (raked the other way) */}
      <div className="scene-cut scene-cut--l cut-ink-cream" aria-hidden="true" />

      {/* For whom */}
      <section className="mx-auto max-w-3xl px-5 py-12 text-center">
        <h2 className="text-2xl font-bold tracking-tight">{t.forWhoTitle}</h2>
        <p className="mt-2 text-gray-600">{t.forWho}</p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
          {t.industries.map(({ label, icon: Icon }) => (
            <span key={label} className="inline-flex items-center gap-2 rounded-full bg-[#02C39A]/12 px-4 py-2 text-sm font-semibold text-[#028090]">
              <Icon className="h-4 w-4" /> {label}
            </span>
          ))}
          <span className="inline-flex items-center rounded-full bg-gray-100 px-4 py-2 text-sm font-medium text-gray-400">{t.soon}</span>
        </div>
      </section>

      {/* Trust block — the direct answer to what competitors are hated
          for (predatory billing). The no-stored-card line gets top billing
          because it makes the promise STRUCTURAL, not aspirational. */}
      <section className="mx-auto max-w-3xl px-5 pb-4">
        <div className="relative overflow-hidden rounded-2xl bg-[#0B2027] p-6 text-[#F5EFE1] sm:p-7">
          <div className="film-grain" aria-hidden="true" />
          <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight">
            <ShieldCheck className="h-5 w-5 text-[#02C39A]" /> {t.trustTitle}
          </h2>
          <p className="mt-3 text-[15px] font-semibold leading-relaxed text-[#02C39A]">
            {t.trustKiller}
          </p>
          <ul className="mt-4 grid gap-2 sm:grid-cols-3">
            {t.trustItems.map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm text-[#F5EFE1]/85">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#02C39A]" /> {item}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Pricing — one plan, no comparison table (founder-locked numbers). */}
      <section className="mx-auto max-w-3xl px-5 pb-12">
        <div className="mx-auto max-w-md rounded-2xl border border-[#028090]/25 bg-white p-7 text-center shadow-sm">
          <h2 className="text-xl font-bold tracking-tight text-gray-900">{t.priceTitle}</h2>
          <p className="mt-3">
            <span className="text-5xl font-extrabold tracking-tight text-[#0B2027]">{t.priceAmount}</span>
            <span className="text-lg font-medium text-gray-500">{t.priceUnit}</span>
          </p>
          <ul className="mx-auto mt-5 max-w-xs space-y-2.5 text-left">
            {t.priceBullets.map((b) => (
              <li key={b} className="flex items-start gap-2.5 text-sm text-gray-700">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#02C39A]" /> {b}
              </li>
            ))}
          </ul>
          {/* No-lock-in promise — the direct counter to competitors' #1
              complaint (predatory billing / hard-to-cancel). Made loud. */}
          <p className="mx-auto mt-5 flex max-w-xs items-center justify-center gap-1.5 rounded-full bg-[#02C39A]/12 px-4 py-2 text-sm font-semibold text-[#0B7A5E]">
            <ShieldCheck className="h-4 w-4 shrink-0" /> {t.priceLockIn}
          </p>
          <Link
            href={signupHref}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-brand px-6 py-3.5 text-base font-semibold text-white transition-transform active:scale-[.99]"
          >
            {t.priceCta} <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      {/* Layla add-on */}
      <section className="mx-auto max-w-3xl px-5 pb-12">
        <div className="flex flex-col items-start gap-3 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm sm:flex-row sm:items-center">
          <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#02C39A]/15 text-[#028090]"><Sprout className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-gray-900">{t.laylaTitle}</h3>
            <p className="mt-1 text-sm text-gray-600">{t.layla}</p>
            <a href="tel:+13019622856" className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-[#028090] hover:underline">
              <Phone className="h-4 w-4" /> {t.laylaCall} — (301) 962-2856
            </a>
          </div>
          <Link href="/book-demo" className="shrink-0 text-sm font-semibold text-[#028090] hover:underline">{t.laylaCta} →</Link>
        </div>
      </section>

      {/* scene-cut: cream → ink, into the close */}
      <div className="scene-cut cut-cream-ink" aria-hidden="true" />

      {/* Close — dark final CTA with the family film grain */}
      <section className="relative overflow-hidden bg-[#0B2027] px-5 py-16 text-center text-[#F5EFE1]">
        <h2 className="text-3xl font-extrabold tracking-tight">{t.closeTitle}</h2>
        <p className="mx-auto mt-2 max-w-sm text-[#F5EFE1]/70">{t.closeSub}</p>
        <Link href={signupHref} className="mt-6 inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-brand px-7 py-3.5 text-base font-semibold text-white active:scale-[.99] transition-transform">
          {t.closeCta} <ArrowRight className="h-4 w-4" />
        </Link>
        <div className="film-grain" aria-hidden="true" />
      </section>
      </main>

      <footer className="mx-auto max-w-3xl px-5 py-8 text-center text-xs text-gray-400">
        {t.footer} · © 2026 Tarhunna
      </footer>
    </div>
  )
}
