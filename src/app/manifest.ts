import type { MetadataRoute } from 'next'

// PWA manifest — makes Tarhunna installable to the home screen, which
// matters for a mobile-only, phone-first audience that lives in their
// home screen, not a browser bookmark. Spanish-first (`lang`, `dir`),
// brand-navy theme, standalone display so it opens chromeless like a
// native app. Icons are square PNGs generated from the 512 source.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Tarhunna — CRM en español',
    short_name: 'Tarhunna',
    description:
      'Cree un estimado en 2 minutos, mándelo por WhatsApp, y cobre. El CRM en español para negocios de servicios.',
    lang: 'es',
    dir: 'ltr',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#FAF6EC',
    theme_color: '#0B2027',
    categories: ['business', 'productivity'],
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
