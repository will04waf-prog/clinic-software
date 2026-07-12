import type { Metadata } from 'next'
import { LoopLanding } from '@/components/marketing/loop-landing'

export const metadata: Metadata = {
  title: 'Tarhunna — El CRM en español: cotice, cobre, y siga trabajando',
  description:
    'El CRM en español para negocios de servicios. Cree un estimado en 2 minutos, mándelo por WhatsApp, su cliente lo aprueba con un toque, y usted cobra — con tarjeta, efectivo o Zelle. Desde el teléfono.',
  alternates: { canonical: 'https://tarhunna.net' },
  openGraph: {
    type: 'website',
    siteName: 'Tarhunna',
    title: 'Tarhunna — El CRM en español para su negocio',
    description:
      'Cotice por WhatsApp, cobre con tarjeta, y siga trabajando. El CRM en español para jardinería, limpieza y construcción.',
    url: 'https://tarhunna.net',
    locale: 'es_US',
  },
}

// Home = the loop-first landing, Spanish-lead with an English toggle.
export default function HomePage() {
  return <LoopLanding defaultLocale="es" />
}
