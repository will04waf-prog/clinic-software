import type { Metadata } from 'next'
import { LoopLanding } from '@/components/marketing/loop-landing'

export const metadata: Metadata = {
  title: 'Tarhunna — Mande el estimado hoy. Cobre esta semana.',
  description:
    'El CRM en español para negocios de servicios. Cree un estimado en 2 minutos, mándelo por WhatsApp, su cliente lo aprueba con un toque, y usted cobra — con tarjeta, efectivo o Zelle.',
  alternates: { canonical: 'https://tarhunna.net/es' },
  openGraph: {
    type: 'website',
    siteName: 'Tarhunna',
    title: 'Tarhunna — El CRM en español para su negocio',
    description: 'Cotice por WhatsApp, cobre con tarjeta, y siga trabajando.',
    url: 'https://tarhunna.net/es',
    locale: 'es_US',
  },
}

export default function EsPage() {
  return (
    <div lang="es">
      <LoopLanding defaultLocale="es" />
    </div>
  )
}
