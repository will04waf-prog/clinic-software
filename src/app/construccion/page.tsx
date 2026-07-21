import type { Metadata } from 'next'
import { LoopLanding } from '@/components/marketing/loop-landing'

/**
 * /construccion — the construction/remodeling funnel (industry ladder,
 * founder-ordered 2026-07-21). Rides the existing 'trades' vertical
 * (Layla urgent detection included); the hook is the verbal
 * change-order pain — one-tap WRITTEN approval with date and time.
 */
export const metadata: Metadata = {
  // No 'Tarhunna —' prefix: the root layout's title template appends
  // '| Tarhunna' (book-demo lesson — avoid the double brand).
  title: 'El CRM en español para contratistas y construcción',
  description:
    'Cada trabajo y cada extra aprobado por escrito, con un toque en WhatsApp — queda constancia con fecha y hora. Estimados en 2 minutos, y cobre con tarjeta, efectivo o Zelle. $39/mes, sin contratos.',
  alternates: { canonical: 'https://tarhunna.net/construccion' },
  openGraph: {
    type: 'website',
    siteName: 'Tarhunna',
    // og:title is NOT covered by the layout title template — brand it
    // explicitly (matches /limpieza).
    title: 'Tarhunna — El CRM en español para contratistas y construcción',
    description:
      'Se acabó el «yo nunca aprobé ese extra»: aprobaciones por escrito con un toque en WhatsApp, estimados en 2 minutos, y cobre como quiera. $39/mes, sin contratos.',
    url: 'https://tarhunna.net/construccion',
    locale: 'es_US',
  },
}

export default function ConstruccionPage() {
  return <LoopLanding defaultLocale="es" variant="construccion" />
}
