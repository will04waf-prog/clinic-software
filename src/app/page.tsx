import type { Metadata } from 'next'
import { LoopLanding } from '@/components/marketing/loop-landing'

export const metadata: Metadata = {
  title: 'Tarhunna — Mande el estimado hoy. Cobre esta semana.',
  description:
    'El CRM en español para negocios de servicios. Cree un estimado en 2 minutos, mándelo por WhatsApp, su cliente lo aprueba con un toque, y usted cobra — con tarjeta, efectivo o Zelle. Desde el teléfono.',
  alternates: { canonical: 'https://tarhunna.net' },
  openGraph: {
    type: 'website',
    siteName: 'Tarhunna',
    title: 'Tarhunna — El CRM en español para su negocio',
    description:
      'Mande el estimado hoy. Cobre esta semana. El CRM en español para negocios de servicios.',
    url: 'https://tarhunna.net',
    locale: 'es_US',
  },
}

// Home = the loop-first landing, Spanish-lead with an English toggle.
export default function HomePage() {
  return <LoopLanding defaultLocale="es" />
}
