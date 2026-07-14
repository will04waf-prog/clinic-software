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
    description: 'Send the estimate today. Get paid this week. The bilingual CRM for the trades — English and Spanish.',
    url: 'https://tarhunna.net/trades',
    locale: 'en_US',
  },
}

export default function TradesPage() {
  // Root <html lang="es"> is the product default; this page's content is
  // English, so scope the subtree lang for screen readers + SEO.
  return (
    <div lang="en">
      <LoopLanding defaultLocale="en" variant="trades" />
    </div>
  )
}
