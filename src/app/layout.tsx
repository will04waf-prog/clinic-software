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
    'clinic CRM',
    'med spa CRM',
    'plastic surgery CRM',
    'aesthetic clinic software',
    'medical spa management',
    'consultation booking software',
    'patient lead management',
  ],
  openGraph: {
    type: 'website',
    siteName: 'Tarhunna',
    title: 'Tarhunna – CRM for Aesthetic Clinics',
    description:
      'Capture leads, automate follow-ups, book consultations, and reduce no-shows. CRM software built for med spas and plastic surgery clinics.',
    url: 'https://tarhunna.net',
  },
  twitter: {
    card: 'summary',
    title: 'Tarhunna – CRM for Aesthetic Clinics',
    description:
      'Capture leads, automate follow-ups, book consultations, and reduce no-shows. CRM software built for med spas and plastic surgery clinics.',
  },
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
