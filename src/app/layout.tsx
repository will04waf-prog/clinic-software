import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'ClinIQ – Plastic Surgery Clinic CRM',
  description: 'Capture leads, book consultations, reduce no-shows. Built for plastic surgery clinics.',
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
