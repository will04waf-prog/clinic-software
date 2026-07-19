import type { Metadata } from 'next'
import Link from 'next/link'
import { Phone, MessageCircle, CalendarCheck, Zap, ShieldCheck } from 'lucide-react'
import { BookDemoForm } from './book-demo-form'
import { LogoMark } from '@/components/ui/logo-mark'

/**
 * /book-demo — "Conozca a Layla". Rebuilt 2026-07-15 (route archaeology):
 * the previous page sold Layla as "the AI receptionist for clinics" with
 * the retired $147/$297/$497 tier ladder. Layla is now the ADD-ON to the
 * $39 loop CRM, demoed live on the landscaping line. Spanish-first, same
 * visual system as the loop landing. The request form + /api/demo pipeline
 * is preserved (field names unchanged).
 */
export const metadata: Metadata = {
  title: 'Conozca a Layla — la recepcionista con IA',
  description:
    'Llame ahora y escuche a Layla contestar como una empresa de jardinería de verdad — en inglés y español. La recepcionista con IA, un complemento del CRM Tarhunna.',
  robots: { index: true, follow: true },
  alternates: { canonical: 'https://tarhunna.net/book-demo' },
}

const DEMO_LINE_DISPLAY = '(301) 962-2856'
const DEMO_LINE_TEL = 'tel:+13019622856'

const CAPABILITIES = [
  {
    icon: Phone,
    h: 'Contesta cuando usted no puede',
    b: 'Usted está con las manos en la tierra. Layla contesta al primer timbre, en inglés y en español, y nunca deja ir una llamada al buzón.',
  },
  {
    icon: MessageCircle,
    h: 'Le avisa por WhatsApp',
    b: 'Cada llamada le llega como un resumen a su WhatsApp: quién llamó, qué quiere, y su número para devolver la llamada.',
  },
  {
    icon: Zap,
    h: 'Detecta urgencias',
    b: 'Si un cliente tiene una emergencia — una fuga de riego, un árbol caído — Layla le manda una alerta URGENTE al instante con el problema y el número.',
  },
  {
    icon: CalendarCheck,
    h: 'Toma mensajes y agenda',
    b: 'Deja cada mensaje ordenado en su panel, y puede agendar visitas directamente en su calendario.',
  },
]

export default function BookDemoPage() {
  return (
    <div className="min-h-screen bg-[#F5EFE1] text-gray-900">
      {/* Top bar — same shell as the loop landing */}
      <header className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4">
        <Link href="/"><LogoMark size="md" standalone priority /></Link>
        <Link
          href="/signup"
          className="rounded-full bg-[#028090] px-4 py-1.5 text-sm font-semibold text-white hover:bg-[#026B78]"
        >
          Empezar gratis
        </Link>
      </header>

      <main>
        {/* Hero: the live call IS the demo. No form required to hear her. */}
        <section className="mx-auto max-w-3xl px-5 pt-8 pb-6 text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#028090]">
            Complemento del CRM Tarhunna
          </p>
          <h1 className="mx-auto mt-3 max-w-2xl text-4xl font-extrabold leading-[1.08] tracking-tight text-balance sm:text-5xl">
            Conozca a Layla.
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-lg text-gray-600">
            La recepcionista con inteligencia artificial que contesta su teléfono
            — en inglés y español — mientras usted trabaja.
          </p>

          {/* The star CTA: call the live line right now. */}
          <a
            href={DEMO_LINE_TEL}
            className="mt-7 inline-flex w-full max-w-md items-center justify-center gap-2.5 rounded-xl bg-gradient-brand px-6 py-4 text-lg font-bold text-white transition-transform active:scale-[.99]"
          >
            <Phone className="h-5 w-5" /> Llámela ahora — {DEMO_LINE_DISPLAY}
          </a>
          <p className="mx-auto mt-3 max-w-sm text-sm text-gray-500">
            Es una línea de demostración en vivo: Layla contesta como una empresa
            de jardinería de verdad. Pregúntele lo que quiera, en el idioma que quiera.
          </p>
        </section>

        {/* What she does — loop-relevant, no tiers, no clinics. */}
        <section className="mx-auto max-w-3xl px-5 py-8">
          <div className="grid gap-3 sm:grid-cols-2">
            {CAPABILITIES.map(({ icon: Icon, h, b }) => (
              <div key={h} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[#02C39A]/15 text-[#028090]">
                  <Icon className="h-5 w-5" />
                </span>
                <h2 className="mt-3 font-semibold text-gray-900">{h}</h2>
                <p className="mt-1 text-sm leading-relaxed text-gray-600">{b}</p>
              </div>
            ))}
          </div>
          <p className="mt-4 flex items-start gap-2 rounded-xl bg-[#0B2027] px-4 py-3 text-sm text-[#F5EFE1]/90">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#02C39A]" />
            Layla es un complemento opcional del CRM Tarhunna ($39/mes). Se activa
            con nuestro equipo cuando usted esté listo — sin contratos, como todo lo demás.
          </p>
        </section>

        {/* The request form — kept pipeline, reframed ask. */}
        <section className="mx-auto max-w-3xl px-5 py-8">
          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm sm:p-7">
            <h2 className="text-xl font-bold tracking-tight">¿Quiere que lo llamemos?</h2>
            <p className="mt-1 text-sm text-gray-600">
              Déjenos sus datos y un fundador — no un vendedor — lo llama para
              mostrarle Layla con su propio negocio. 20 minutos, en español o inglés.
            </p>
            <div className="mt-5">
              <BookDemoForm />
            </div>
          </div>
        </section>
      </main>

      <footer className="mx-auto max-w-3xl px-5 py-8 text-center text-xs text-gray-400">
        El CRM en español para negocios de servicios. · © 2026 Tarhunna
      </footer>
    </div>
  )
}
