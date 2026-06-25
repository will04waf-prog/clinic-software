'use client'
import Link from 'next/link'
import { Calendar, ArrowRight } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * Small navigation card on /settings that points to the dedicated
 * /settings/booking surface. The booking configuration is too dense
 * (providers, services, weekly hours, overrides, preview) to inline
 * here — this is the front door.
 */
export function BookingSettingsLinkCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-brand-600" />
          Booking calendar
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm">
        <p className="text-gray-500">
          Configure the providers, services, weekly hours, and time-off that
          drive your booking calendar. Confirmed bookings appear in
          Consultations and trigger your reminder and follow-up automations.
        </p>
        <Link
          href="/settings/booking"
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
        >
          Manage
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </CardContent>
    </Card>
  )
}
