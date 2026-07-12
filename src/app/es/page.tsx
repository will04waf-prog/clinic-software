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
import { DemoCallPill } from '@/components/marketing/demo-call-pill'

/**
 * /es — landing en español para dueños de negocios de servicios
 * (jardinería, limpieza, construcción, comida) que trabajan en español
 * y cuyos clientes muchas veces llaman en inglés.
 *
 * Página intencionalmente SIN enlaces entrantes desde el resto del
 * sitio (pendiente de aprobación del fundador); solo se llega por URL
 * directa. No enlazar desde nav, footer ni sitemap hasta que se apruebe.
 */

const TEL_HREF = 'tel:+18555894238'
const DEMO_NUMBER = '(855) 589-4238'

export const metadata: Metadata = {
  title: 'Layla — la recepcionista con IA que contesta en español y en inglés',
  description:
    'Sus clientes llaman en inglés. Usted trabaja en español. Layla contesta el número de su negocio las 24 horas, agenda el trabajo en la misma llamada, confirma por texto y le avisa al instante cuando hay una urgencia. Para jardinería, limpieza, construcción y comida.',
  alternates: {
    canonical: 'https://tarhunna.net/es',
  },
  openGraph: {
    type: 'website',
    siteName: 'Tarhunna',
    title: 'Layla — la recepcionista con IA que contesta en español y en inglés',
    description:
      'Layla contesta el teléfono de su negocio las 24 horas, en el idioma del cliente, agenda el trabajo en la misma llamada y le avisa al momento cuando hay una urgencia.',
    url: 'https://tarhunna.net/es',
    locale: 'es_LA',
  },
}

// ── Qué hace Layla en cada llamada — verbos de recepcionista ──
const VERBOS = [
  {
    icon: PhoneCall,
    title: 'Contesta',
    body: 'Al segundo timbre, en el número de siempre de su negocio, con el nombre de su negocio. A la 1 de la tarde o a las 11 de la noche — ella no se va a almorzar ni se enferma.',
  },
  {
    icon: Languages,
    title: 'Habla los dos idiomas',
    body: 'Saluda, escucha y responde en el idioma del cliente. Y si el cliente empieza en inglés y cambia al español a media llamada, Layla cambia con él — en la misma conversación, sin transferir a nadie.',
    bilingual: true,
  },
  {
    icon: CalendarCheck,
    title: 'Agenda el trabajo',
    body: 'Pregunta qué necesitan, dónde y para cuándo, y deja la cita agendada antes de colgar. Se acabó el «déjeme ver y le devuelvo la llamada» que nunca llega.',
  },
  {
    icon: MessageSquareText,
    title: 'Confirma por texto',
    body: 'Al colgar, el cliente recibe un mensaje de texto con la confirmación: fecha y hora. Menos citas olvidadas, menos vueltas en vano.',
  },
  {
    icon: BellRing,
    title: 'Le avisa cuando es urgente',
    body: 'Fuga de agua, tubería rota, olor a gas: Layla lo reconoce en el momento y usted recibe una alerta inmediata con el número del cliente y el problema. Usted decide si llama o si va directo.',
  },
  {
    icon: FileText,
    title: 'Deja todo por escrito',
    body: 'Cada llamada queda registrada con su transcripción completa en su panel. Nada se queda en un recado de papel ni en la memoria de nadie.',
  },
] as const

// ── La historia de la urgencia — el diferenciador ──
const URGENCIA_PASOS = [
  {
    icon: Droplets,
    hora: '9:14 PM',
    title: 'Entra la llamada',
    body: 'Un cliente llama desesperado: hay agua saliendo por debajo del calentador. Su cuadrilla ya se fue a casa. Layla contesta al segundo timbre.',
  },
  {
    icon: BellRing,
    hora: '9:15 PM',
    title: 'Layla detecta la urgencia',
    body: 'Reconoce que esto no es una cotización. Le pide la dirección al cliente, le confirma que el dueño va a ser avisado de inmediato y toma todos los datos.',
  },
  {
    icon: Smartphone,
    hora: '9:15 PM',
    title: 'Su teléfono vibra',
    body: 'Le llega un mensaje con el número del cliente y el problema, tal como el cliente lo describió. Usted devuelve la llamada o arranca la camioneta — pero se entera al minuto, no mañana.',
  },
] as const

// ── Para quién es ──
const RUBROS = [
  { icon: TreePine, label: 'Jardinería y paisajismo' },
  { icon: Sparkles, label: 'Limpieza' },
  { icon: Hammer, label: 'Construcción y oficios' },
  { icon: UtensilsCrossed, label: 'Comida y restaurantes' },
] as const

export default function SpanishLandingPage() {
  return (
    <SmoothScrollProvider>
      {/* lang="es" en el contenedor raíz: el layout raíz declara
          lang="en" para todo el sitio; este atributo corrige el idioma
          para lectores de pantalla y traductores en esta página. */}
      <div lang="es" className="landing-page flex min-h-screen flex-col bg-[#F5EFE1]">

        {/* ── Nav mínima — sin enlaces al resto del sitio ─────── */}
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
                Hablar con el fundador
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
                  La recepcionista con IA que contesta en español y en inglés.
                </p>
              </div>
              <h1 className="rise text-4xl font-extrabold leading-[1.08] tracking-tight text-gray-900 sm:text-5xl lg:text-6xl" style={{ '--stagger': 1 } as React.CSSProperties}>
                Está perdiendo <HeroEcho className="whitespace-nowrap text-[#14241d]">1 de cada 4 llamadas.</HeroEcho> Ahora mismo.
              </h1>
              <p className="rise mt-5 text-lg text-gray-500 sm:text-xl max-w-2xl mx-auto" style={{ '--stagger': 2 } as React.CSSProperties}>
                Sus clientes llaman en inglés. Usted trabaja en español. Layla habla los dos:
                contesta el número de su negocio las 24 horas, agenda el trabajo en la misma
                llamada y manda la confirmación por texto — mientras usted sigue trabajando.
              </p>
              <p className="rise mt-3 text-xs text-gray-400" style={{ '--stagger': 3 } as React.CSSProperties}>
                El 82% de las personas que llaman y nadie les contesta dicen que su siguiente
                llamada es a la competencia — encuesta de CallRail, 2025.
              </p>
              <div className="rise mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center" style={{ '--stagger': 4 } as React.CSSProperties}>
                <MagneticCta className="w-full sm:w-auto">
                  <Link
                    href="/book-demo"
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-brand px-6 py-3 text-base font-semibold text-white hover:scale-[1.02] transition-all duration-150 shadow-sm"
                  >
                    Agendar una demo de 20 minutos
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </MagneticCta>
              </div>

              {/* Línea de demostración en vivo — la mejor prueba de la página.
                  Layla contesta este número como recepcionista de Rivera
                  Landscaping, una empresa de jardinería ficticia. */}
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
                    Demostración en vivo — contesta Layla
                  </span>
                  <span className="block text-lg font-extrabold tracking-tight text-gray-900 sm:text-xl">
                    {DEMO_NUMBER}
                  </span>
                  <span className="block text-[12px] text-gray-500">
                    Llame ahora y hable en el idioma que quiera. Cambie a media llamada — ella lo sigue.
                  </span>
                </span>
              </a>
              <p className="rise mt-3 text-[11px] text-gray-400" style={{ '--stagger': 6 } as React.CSSProperties}>
                Layla contesta como recepcionista de Rivera Landscaping, una empresa de
                jardinería ficticia para la demostración. La llamada es real; la empresa no.
              </p>

              <div className="rise mt-8 flex flex-col items-center gap-2 sm:flex-row sm:justify-center sm:gap-6" style={{ '--stagger': 7 } as React.CSSProperties}>
                {[
                  'Contesta 24/7 — noches, domingos y feriados',
                  'Español e inglés en la misma llamada',
                  'La demo es con un fundador, no con un vendedor',
                ].map((item) => (
                  <div key={item} className="flex items-center gap-1.5 text-sm text-gray-500">
                    <CheckCircle className="h-4 w-4 text-brand-500 shrink-0" aria-hidden="true" />
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* ── La urgencia — al frente y al centro ──────────── */}
          <section className="relative overflow-hidden bg-[#14241d] px-6 py-20">
            <AuroraDrift />
            <div className="relative z-10 mx-auto max-w-6xl">
              <AnimatedSection className="mb-12 text-center">
                <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-brand-500/30 bg-brand-500/10 px-3 py-1">
                  <BellRing className="h-3.5 w-3.5 text-[#02C39A]" aria-hidden="true" />
                  <span className="text-xs font-semibold uppercase tracking-wider text-[#F5EFE1]">
                    Llamadas urgentes
                  </span>
                </div>
                <h2 className="text-3xl font-bold tracking-tight text-[#F5EFE1] sm:text-4xl">
                  Una fuga de agua a las 9 de la noche no deja recado.
                </h2>
                <p className="mt-3 text-[#F5EFE1]/70 max-w-2xl mx-auto">
                  Cuelga y le marca al siguiente de la lista. Con Layla, esa llamada la
                  contesta su negocio — y usted se entera al minuto.
                </p>
              </AnimatedSection>
              <div className="grid gap-5 sm:grid-cols-3">
                {URGENCIA_PASOS.map(({ icon: Icon, hora, title, body }, index) => (
                  <AnimatedCard
                    key={title}
                    index={index}
                    className="rounded-xl border border-brand-500/30 bg-[#F5EFE1] p-6 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-500/60 hover:shadow-md"
                  >
                    <div className="mb-4 flex items-center justify-between">
                      <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-brand-500/20">
                        <Icon className="h-5 w-5 text-[#14241d]" aria-hidden="true" />
                      </div>
                      <span className="text-xs font-bold uppercase tracking-wider text-[#028090]">{hora}</span>
                    </div>
                    <h3 className="mb-2 text-base font-semibold text-gray-900">{title}</h3>
                    <p className="text-sm text-gray-600 leading-relaxed">{body}</p>
                  </AnimatedCard>
                ))}
              </div>
              {/* Honestidad sobre el canal: SMS hoy, WhatsApp muy pronto. */}
              <AnimatedSection className="mt-8 flex justify-center">
                <p className="inline-flex flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-full border border-[#F5EFE1]/20 bg-[#F5EFE1]/5 px-5 py-2.5 text-center text-sm text-[#F5EFE1]/80">
                  <span className="font-semibold text-[#F5EFE1]">Alertas por SMS desde el primer día.</span>
                  <span>Alertas por WhatsApp — muy pronto.</span>
                </p>
              </AnimatedSection>
            </div>
          </section>

          {/* ── Qué hace Layla en cada llamada ───────────────── */}
          <section className="bg-[#F5EFE1] px-6 py-20">
            <div className="mx-auto max-w-6xl">
              <AnimatedSection className="mb-12 text-center">
                <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-brand-500/40 bg-brand-500/10 px-3 py-1">
                  <PhoneCall className="h-3.5 w-3.5 text-[#14241d]" aria-hidden="true" />
                  <span className="text-xs font-semibold uppercase tracking-wider text-[#14241d]">
                    Layla · recepcionista con IA
                  </span>
                </div>
                <h2 className="text-3xl font-bold tracking-tight text-gray-900">
                  Qué hace Layla en cada llamada
                </h2>
                <p className="mt-3 text-gray-500 max-w-xl mx-auto">
                  Lo mismo que haría una buena recepcionista — solo que nunca está ocupada,
                  nunca se va a casa y habla los dos idiomas.
                </p>
              </AnimatedSection>
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {VERBOS.map(({ icon: Icon, title, body, ...rest }, index) => (
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
                    {'bilingual' in rest && <BilingualRoll layoutId="bilingual-roll-pill-es" />}
                  </AnimatedCard>
                ))}
              </div>
            </div>
          </section>

          {/* ── El resumen del día, en su idioma ─────────────── */}
          <section className="bg-[#FAF6EC] bg-dot-grid px-6 py-20">
            <div className="mx-auto max-w-5xl">
              <AnimatedSection className="grid gap-10 lg:grid-cols-[1.1fr_1fr] lg:items-center">
                <div>
                  <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-brand-500/15">
                    <FileText className="h-6 w-6 text-[#026B78]" aria-hidden="true" />
                  </div>
                  <h2 className="text-3xl font-bold tracking-tight text-gray-900">
                    El cliente llamó en inglés. Usted lo lee en español.
                  </h2>
                  <p className="mt-4 text-gray-500 leading-relaxed">
                    Cada llamada queda en su panel con la transcripción completa: quién llamó,
                    qué necesita y qué quedó agendado. Usted lo revisa en español o en inglés —
                    como prefiera — desde el celular, en la noche o entre un trabajo y otro.
                  </p>
                  <p className="mt-3 text-gray-500 leading-relaxed">
                    Se acabó eso de adivinar qué pasó con el teléfono mientras usted estaba
                    arriba de una escalera.
                  </p>
                </div>
                <ul className="space-y-3">
                  {[
                    'Todas las llamadas del día en una sola pantalla',
                    'Transcripción palabra por palabra de cada conversación',
                    'Las citas que Layla agendó, con fecha y hora',
                    'Las urgencias marcadas, con el número de quien llamó',
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

          {/* ── Para quién es ────────────────────────────────── */}
          <section className="bg-[#F5EFE1] px-6 py-20">
            <div className="mx-auto max-w-5xl">
              <AnimatedSection className="mb-10 text-center">
                <h2 className="text-3xl font-bold tracking-tight text-gray-900">
                  Hecha para negocios que trabajan con las manos
                </h2>
                <p className="mt-3 text-gray-500 max-w-2xl mx-auto">
                  Si las llamadas entran mientras usted está cortando pasto, en un techo o con
                  la cocina llena, Layla es la recepcionista que su negocio no ha podido contratar.
                </p>
              </AnimatedSection>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {RUBROS.map(({ icon: Icon, label }, index) => (
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

          {/* ── CTA final ────────────────────────────────────── */}
          <section id="final-cta" className="relative overflow-hidden bg-[#14241d] px-6 py-20">
            <AuroraDrift />
            <AnimatedSection className="relative z-10 mx-auto max-w-2xl text-center">
              <LogoMark size="lg" standalone className="mb-3" />
              <h2 className="text-3xl font-bold tracking-tight text-[#F5EFE1] sm:text-4xl">
                Deje que Layla conteste su próxima llamada
              </h2>
              <p className="mt-4 text-[#F5EFE1]/70">
                En una demo de 20 minutos, un fundador le muestra cómo sonaría Layla
                contestando el teléfono de su negocio — con sus servicios y su horario.
                Sin compromiso.
              </p>
              <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
                <MagneticCta className="w-full sm:w-auto">
                  <Link
                    href="/book-demo"
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-brand px-6 py-3 text-base font-semibold text-white hover:scale-[1.02] transition-all duration-150 shadow-sm"
                  >
                    Agendar demo con el fundador
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
                    O primero llámela usted
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
              <span className="text-sm text-gray-400">· Recepcionista con IA para negocios de servicios</span>
            </div>
            <div className="flex items-center gap-5 text-sm text-gray-500">
              <Link href="/privacy" className="hover:text-gray-900 transition-colors">Privacidad</Link>
              <Link href="/terms" className="hover:text-gray-900 transition-colors">Términos</Link>
              <span>© {new Date().getFullYear()} Tarhunna</span>
            </div>
          </div>
        </footer>

        <DemoCallPill
          telHref={TEL_HREF}
          number={DEMO_NUMBER}
          eyebrow="Layla está en línea"
          mobileNote="— contesta Layla"
          callLabel={`Llamar a la línea de demostración, ${DEMO_NUMBER} — contesta Layla`}
          dismissLabel="Cerrar el recordatorio de la línea de demostración"
          storageKey="tarhunna-es-call-pill-dismissed"
        />

      </div>
    </SmoothScrollProvider>
  )
}
