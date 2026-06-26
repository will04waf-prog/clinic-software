'use client'
import Link from 'next/link'
import { PhoneCall, ArrowRight } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * Phase 5 W1 — link card on /settings pointing at /settings/call-agent.
 * Owner-only — the parent settings/page.tsx conditionally renders
 * this. The page itself also redirects non-owners (defense in depth).
 */
export function CallAgentLinkCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PhoneCall className="h-4 w-4 text-brand-600" />
          Call agent
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm">
        <p className="text-gray-500">
          The AI receptionist that answers your phone after hours. Books
          appointments live during the call, hands off real emergencies
          to your team, and lands every call in the contact timeline
          with transcript and audio. Scale plan only.
        </p>
        <Link
          href="/settings/call-agent"
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
        >
          Configure
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </CardContent>
    </Card>
  )
}
