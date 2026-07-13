import type { Metadata, Viewport } from 'next'
import { Inter, Great_Vibes, Newsreader } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })
const greatVibes = Great_Vibes({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-great-vibes',
  display: 'swap',
})
// Used by the morning-briefing dashboard for the pull-quote hero and the
// large numeric values (Up-Next time, week-strip values, big count).
// Optical-size variable font; weights 400-600.
const newsreader = Newsreader({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-newsreader',
  display: 'swap',
})

// iOS: viewport-fit=cover lets env(safe-area-inset-*) resolve, so the
// app shell can pad around the notch/home indicator instead of drawing
// under the status bar. themeColor paints browser chrome brand-navy.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0B2027',
}

export const metadata: Metadata = {
  metadataBase: new URL('https://tarhunna.net'),
  title: {
    default: 'Tarhunna — El CRM en español para negocios de servicios',
    template: '%s | Tarhunna',
  },
  description:
    'El CRM en español para negocios de servicios. Cree un estimado en 2 minutos, mándelo por WhatsApp, su cliente lo aprueba con un toque, y usted cobra — con tarjeta, efectivo o Zelle. Desde el teléfono.',
  keywords: [
    'CRM en español',
    'software para jardinería',
    'estimados por WhatsApp',
    'cobrar con tarjeta',
    'CRM para negocios de servicios',
    'app para landscaping',
    'estimados por WhatsApp',
    'CRM for landscaping',
    'estimates by WhatsApp',
    'Spanish CRM for contractors',
    'field service CRM Spanish',
    'get paid landscaping app',
  ],
  authors: [{ name: 'Tarhunna', url: 'https://tarhunna.net' }],
  creator: 'Tarhunna',
  publisher: 'Tarhunna',
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  openGraph: {
    type: 'website',
    siteName: 'Tarhunna',
    title: 'Tarhunna — El CRM en español para su negocio',
    description:
      'Cotice por WhatsApp, cobre con tarjeta, y siga trabajando. El CRM en español para jardinería, limpieza y construcción.',
    url: 'https://tarhunna.net',
    locale: 'es_US',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Tarhunna — El CRM en español para su negocio',
    description:
      'Cotice por WhatsApp, cobre con tarjeta, y siga trabajando. El CRM en español para negocios de servicios.',
    creator: '@tarhunna',
  },
  alternates: {
    canonical: 'https://tarhunna.net',
  },
  category: 'technology',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${greatVibes.variable} ${newsreader.variable} h-full`}>
      <body className={`${inter.className} h-full antialiased bg-[#F5EFE1]`}>
        {children}
      </body>
    </html>
  )
}
