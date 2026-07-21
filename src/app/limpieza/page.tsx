import type { Metadata } from 'next'
import { LoopLanding } from '@/components/marketing/loop-landing'

/**
 * /limpieza — the cleaning-vertical funnel (industry ladder step 2).
 * Spanish-first like /: same LoopLanding, limpieza hook copy, and the
 * signup CTA carries ?v=limpieza so the org lands in the cleaning
 * vertical with the right service presets.
 */
export const metadata: Metadata = {
  // No 'Tarhunna —' prefix: the root layout's title template appends
  // '| Tarhunna' (book-demo lesson — avoid the double brand).
  title: 'El CRM en español para negocios de limpieza',
  description:
    'Mande el estimado por WhatsApp y su clienta lo aprueba con un toque. Limpiezas semanales que se repiten solas, reseñas de Google automáticas, y cobra con tarjeta, efectivo o Zelle. $39/mes, sin contratos.',
  alternates: { canonical: 'https://tarhunna.net/limpieza' },
  openGraph: {
    type: 'website',
    siteName: 'Tarhunna',
    title: 'Tarhunna — El CRM en español para negocios de limpieza',
    description:
      'Estimados por WhatsApp, aprobación con un toque, limpiezas que se repiten solas y reseñas de Google automáticas. $39/mes, sin contratos.',
    url: 'https://tarhunna.net/limpieza',
    locale: 'es_US',
  },
}

export default function LimpiezaPage() {
  return <LoopLanding defaultLocale="es" variant="limpieza" />
}
