import type { Metadata } from 'next'
import { LoopLanding } from '@/components/marketing/loop-landing'

export const metadata: Metadata = {
  title: 'Tarhunna — Mande el estimado hoy. Cobre esta semana.',
  description:
    'El CRM en español para negocios de servicios. Cree un estimado en 2 minutos, mándelo por WhatsApp, su cliente lo aprueba con un toque, y usted cobra — con tarjeta, efectivo o Zelle. Desde el teléfono.',
  alternates: {
    canonical: 'https://tarhunna.net',
    // English is a client-side toggle, not a URL — the only real English
    // page is /trades. x-default + es-US → home; en-US → the trades page.
    languages: {
      'es-US': 'https://tarhunna.net',
      'en-US': 'https://tarhunna.net/trades',
      'x-default': 'https://tarhunna.net',
    },
  },
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

// SoftwareApplication + Organization structured data → rich-result
// eligibility (price, rating slot, logo) on the page that matters most.
// Acquisition is the bottleneck; this is free surface area in search.
const JSON_LD = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'SoftwareApplication',
      name: 'Tarhunna',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web, iOS, Android',
      inLanguage: 'es',
      description:
        'El CRM en español para negocios de servicios: estimados por WhatsApp, aprobación con un toque, y cobros por tarjeta, efectivo o Zelle.',
      offers: {
        '@type': 'Offer',
        price: '39.00',
        priceCurrency: 'USD',
        description: '14 días gratis, sin tarjeta para empezar.',
      },
      publisher: { '@type': 'Organization', name: 'Tarhunna', url: 'https://tarhunna.net' },
    },
    {
      '@type': 'Organization',
      name: 'Tarhunna',
      url: 'https://tarhunna.net',
      logo: 'https://tarhunna.net/icon-512.png',
    },
  ],
}

// Home = the loop-first landing, Spanish-lead with an English toggle.
export default function HomePage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
      />
      <LoopLanding defaultLocale="es" />
    </>
  )
}
