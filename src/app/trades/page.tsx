import type { Metadata } from 'next'
import { LoopLanding } from '@/components/marketing/loop-landing'

export const metadata: Metadata = {
  title: 'Tarhunna — Send the estimate today. Get paid this week. The bilingual CRM for the trades',
  description:
    'Build an estimate in 2 minutes, send it by WhatsApp, your customer approves in one tap, and you get paid — card, cash, or Zelle. And half your customers speak Spanish. Tarhunna handles both.',
  alternates: { canonical: 'https://tarhunna.net/trades' },
  openGraph: {
    type: 'website',
    siteName: 'Tarhunna',
    title: 'Tarhunna — The bilingual CRM for the trades',
    description: 'Quote by WhatsApp, get paid by card, and keep working. English and Spanish.',
    url: 'https://tarhunna.net/trades',
    locale: 'en_US',
  },
}

export default function TradesPage() {
  return <LoopLanding defaultLocale="en" variant="trades" />
}
