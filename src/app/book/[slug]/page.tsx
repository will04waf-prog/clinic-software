import type { Metadata } from 'next'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { BookingView } from './booking-view'

/**
 * /book/[slug] — Phase 4 W2 public booking page.
 *
 * Anonymous-accessible. proxy.ts allowlists /book/* so unauthenticated
 * patients can hit this page without bouncing to /login.
 *
 * The slug is the organizations.slug — same handle /capture/[slug]
 * uses for intake forms. The actual data fetch happens client-side
 * against /api/booking/public/[slug] so we can render skeleton +
 * progressive states honestly.
 */

export const metadata: Metadata = {
  title: 'Book an appointment',
  description: 'Schedule your visit online — pick a service, pick a time, confirm.',
}

export default async function PublicBookingPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const { slug } = await params
  const sp = await searchParams

  // Layla texts Spanish callers a booking link with ?lang=es; honor it so
  // the customer-facing page renders in Spanish. Anything else = English
  // (the med-spa default path — unchanged).
  const lang = sp.lang === 'es' ? 'es' : 'en'

  // Terminology on this public page follows the tenant's vertical so
  // trades/food/general customers stop seeing med-spa nouns. Fetched
  // here (server) with an explicit single-column select and defaulted to
  // null → med-spa in getVerticalConfig, so a missing/unknown value is
  // byte-identical to today.
  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('vertical')
    .eq('slug', slug)
    .maybeSingle()

  return <BookingView slug={slug} vertical={org?.vertical ?? null} lang={lang} />
}
