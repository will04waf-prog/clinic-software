import type { Metadata } from 'next'
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
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  return <BookingView slug={slug} />
}
