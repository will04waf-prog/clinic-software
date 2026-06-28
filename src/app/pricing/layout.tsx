// Pricing route metadata. The page itself is a client component
// (it owns billing-period toggle state + Stripe checkout fetch), so
// it can't export metadata directly — Next.js requires metadata on
// server components only. This server-component layout sits between
// the app shell and the client page solely to own the SEO tags.

import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Pricing — Tarhunna',
  description:
    'CRM on every plan. AI Twin SMS drafts on Professional. Layla — the AI voice receptionist who answers your phone and books appointments live — on Scale. 14-day free trial.',
}

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return children
}
