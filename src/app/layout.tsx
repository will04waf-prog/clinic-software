import type { Metadata } from 'next'
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

export const metadata: Metadata = {
  metadataBase: new URL('https://tarhunna.net'),
  title: {
    default: 'Tarhunna — AI receptionist + CRM for clinics',
    template: '%s | Tarhunna',
  },
  description:
    "Layla, Tarhunna's AI receptionist, answers every call, books the consult on the line, and texts the confirmation — backed by a full CRM for med spas and aesthetic clinics.",
  keywords: [
    'AI receptionist for clinics',
    'AI receptionist for med spas',
    'AI phone answering service',
    'AI appointment booking',
    'missed call text back',
    'virtual receptionist for medical spa',
    'AI front desk for clinics',
    'answering service for med spa',
    'AI voice agent for medical practice',
    'automated appointment scheduling',
    'med spa CRM',
    'aesthetic clinic CRM',
    'plastic surgery CRM',
    'no-show reduction software',
    'patient communication platform',
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
    title: 'Tarhunna — AI receptionist + CRM for clinics',
    description:
      'Layla answers every call, books the consult on the line, and texts the confirmation — backed by a full CRM for med spas and aesthetic clinics.',
    url: 'https://tarhunna.net',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Tarhunna — AI receptionist + CRM for clinics',
    description:
      'Layla answers every call, books the consult on the line, and texts the confirmation — backed by a full CRM for med spas and aesthetic clinics.',
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
