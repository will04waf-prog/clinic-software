import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  metadataBase: new URL('https://tarhunna.net'),
  title: {
    default: 'Tarhunna – CRM for Aesthetic Clinics',
    template: '%s | Tarhunna',
  },
  description:
    'Tarhunna is a CRM built for med spas and plastic surgery clinics. Capture leads, automate follow-ups, book consultations, and reduce no-shows — all in one platform.',
  keywords: [
    'CRM for med spas',
    'med spa CRM software',
    'aesthetic clinic CRM',
    'plastic surgery CRM',
    'medical spa lead management',
    'aesthetic clinic lead follow-up',
    'consultation booking software',
    'med spa patient management',
    'no-show reduction software',
    'aesthetic practice management',
    'clinic lead capture',
    'med spa automation',
    'plastic surgery patient CRM',
    'aesthetic clinic software',
    'consultation tracking software',
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
    title: 'Tarhunna – CRM for Aesthetic Clinics',
    description:
      'Capture leads, automate follow-ups, book consultations, and reduce no-shows. CRM software built for med spas and plastic surgery clinics.',
    url: 'https://tarhunna.net',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Tarhunna – CRM for Aesthetic Clinics',
    description:
      'Capture leads, automate follow-ups, book consultations, and reduce no-shows. CRM software built for med spas and plastic surgery clinics.',
    creator: '@tarhunna',
  },
  alternates: {
    canonical: 'https://tarhunna.net',
  },
  category: 'technology',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className={`${inter.className} h-full antialiased bg-gray-50`}>
        {children}
      </body>
    </html>
  )
}
