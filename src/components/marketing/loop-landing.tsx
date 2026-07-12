'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  UserPlus, FileText, MessageCircle, CheckCircle2, CalendarDays, CreditCard,
  ArrowRight, Sprout, Sparkles, Leaf, Brush, HardHat,
} from 'lucide-react'

type Locale = 'es' | 'en'
type Variant = 'default' | 'trades'

// Approved loop-first copy (founder-approved 2026-07-12). Spanish is the
// segment's language; the noun is 'estimado' (not 'presupuesto').
const COPY = {
  es: {
    switch: 'English',
    eyebrow: 'El CRM en español para su negocio',
    h1: 'Cotice, cobre, y siga trabajando.',
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
    featTitle: 'Qué hace',
    features: [
      { h: 'Estimados en 2 minutos', b: 'Sus servicios y precios, desde el teléfono, entre un trabajo y otro. Se ve profesional — sin papeleo.', icon: FileText },
      { h: 'Se lo manda por WhatsApp', b: 'Su cliente lo recibe donde ya está. Lo abre y lo aprueba con un toque — sin apps ni cuentas.', icon: MessageCircle },
      { h: 'Se vuelve un trabajo', b: 'Al aprobar, el estimado entra en su agenda. Nada se pierde en un papel ni en la memoria.', icon: CalendarDays },
      { h: 'Cobre como quiera', b: 'Con tarjeta dentro de la app, o marque el efectivo o Zelle. Usted decide; el dinero llega.', icon: CreditCard },
    ],
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
    laylaTitle: 'Layla, un complemento opcional',
    layla: '¿Le suena el teléfono todo el día? Layla, la recepcionista con IA, contesta y agenda por usted — en inglés y español — cuando usted no puede.',
    laylaCta: 'Conocer a Layla',
    closeTitle: 'Empiece gratis hoy.',
    closeSub: 'Sin tarjeta. Configúrelo en minutos, desde el teléfono.',
    closeCta: 'Crear mi cuenta',
    footer: 'El CRM en español para negocios de servicios.',
  },
  en: {
    switch: 'Español',
    eyebrow: 'The Spanish CRM for your business',
    h1: 'Quote, get paid, and keep working.',
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
    featTitle: 'What it does',
    features: [
      { h: 'Estimates in 2 minutes', b: 'Your services and prices, from your phone, between jobs. Looks professional — no paperwork.', icon: FileText },
      { h: 'Send it by WhatsApp', b: 'Your client gets it where they already are. They open it and approve in one tap — no apps, no accounts.', icon: MessageCircle },
      { h: 'It becomes a job', b: 'On approval, the estimate lands on your schedule. Nothing lost on paper or in someone’s memory.', icon: CalendarDays },
      { h: 'Get paid your way', b: 'By card in the app, or mark it cash or Zelle. You choose; the money lands.', icon: CreditCard },
    ],
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
    laylaTitle: 'Layla, an optional add-on',
    layla: 'Phone ringing all day? Layla, the AI receptionist, answers and books for you — in English and Spanish — when you can’t.',
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

export function LoopLanding({ defaultLocale = 'es', variant = 'default' }: { defaultLocale?: Locale; variant?: Variant }) {
  const [locale, setLocale] = useState<Locale>(defaultLocale)
  const t = COPY[locale]
  const h1 = variant === 'trades' && locale === 'en' ? TRADES_HOOK.h1 : t.h1
  const sub = variant === 'trades' && locale === 'en' ? TRADES_HOOK.sub : t.sub

  return (
    <div className="min-h-screen bg-[#F5EFE1] text-gray-900">
      {/* Top bar */}
      <header className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4">
        <span className="text-lg font-bold tracking-tight text-[#14241d]">Tarhunna</span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setLocale((l) => (l === 'es' ? 'en' : 'es'))}
            className="rounded-full border border-[#028090]/30 px-3 py-1 text-xs font-semibold text-[#028090] hover:bg-[#028090]/10"
          >
            {t.switch}
          </button>
          <Link href="/signup" className="rounded-full bg-[#028090] px-4 py-1.5 text-sm font-semibold text-white hover:bg-[#026B78]">
            {t.ctaPrimary}
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-3xl px-5 pt-8 pb-4 text-center">
        <p className="text-xs font-semibold uppercase tracking-widest text-[#028090]">{t.eyebrow}</p>
        <h1 className="mx-auto mt-3 max-w-2xl text-4xl font-extrabold leading-[1.08] tracking-tight sm:text-5xl text-balance">{h1}</h1>
        <p className="mx-auto mt-5 max-w-xl text-lg text-gray-600">{sub}</p>
        <p className="mx-auto mt-4 max-w-lg text-sm text-gray-400">{t.hook}</p>
        <div className="mt-7 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <Link href="/signup" className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-brand px-6 py-3.5 text-base font-semibold text-white active:scale-[.99] transition-transform sm:w-auto">
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

      {/* Loop strip */}
      <section id="como" className="mx-auto max-w-3xl px-5 py-10 scroll-mt-6">
        <h2 className="mb-4 text-center text-sm font-semibold uppercase tracking-wider text-gray-500">{t.loopTitle}</h2>
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

      {/* Bilingual bridge — dark band */}
      <section className="mt-6 bg-[#14241d] px-5 py-14 text-[#F5EFE1]">
        <div className="mx-auto max-w-2xl text-center">
          <Sparkles className="mx-auto h-6 w-6 text-[#02C39A]" />
          <h2 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl text-balance">{t.bridgeTitle}</h2>
          <p className="mx-auto mt-4 max-w-lg text-[#F5EFE1]/75">{t.bridge}</p>
        </div>
      </section>

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

      {/* Layla add-on */}
      <section className="mx-auto max-w-3xl px-5 pb-12">
        <div className="flex flex-col items-start gap-3 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm sm:flex-row sm:items-center">
          <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#02C39A]/15 text-[#028090]"><Sprout className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-gray-900">{t.laylaTitle}</h3>
            <p className="mt-1 text-sm text-gray-600">{t.layla}</p>
          </div>
          <Link href="/book-demo" className="shrink-0 text-sm font-semibold text-[#028090] hover:underline">{t.laylaCta} →</Link>
        </div>
      </section>

      {/* Close */}
      <section className="bg-[#14241d] px-5 py-16 text-center text-[#F5EFE1]">
        <h2 className="text-3xl font-extrabold tracking-tight">{t.closeTitle}</h2>
        <p className="mx-auto mt-2 max-w-sm text-[#F5EFE1]/70">{t.closeSub}</p>
        <Link href="/signup" className="mt-6 inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-brand px-7 py-3.5 text-base font-semibold text-white active:scale-[.99] transition-transform">
          {t.closeCta} <ArrowRight className="h-4 w-4" />
        </Link>
      </section>

      <footer className="mx-auto max-w-3xl px-5 py-8 text-center text-xs text-gray-400">
        {t.footer} · © 2026 Tarhunna
      </footer>
    </div>
  )
}
