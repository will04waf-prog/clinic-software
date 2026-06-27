'use client'

/**
 * Phase 5 W2 — link card on /settings pointing at /settings/faqs.
 *
 * Owner-only — the parent settings/page.tsx conditionally renders
 * this (the FAQ editor itself also hard-redirects non-owners). The
 * editor isn't tier-gated; lookup_faq itself only runs when the
 * call agent is enabled (Scale-only), but pre-authoring the corpus
 * before upgrading is fine.
 */

import Link from 'next/link'
import { ArrowRight, HelpCircle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export function FaqsLinkCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HelpCircle className="h-4 w-4 text-brand-600" />
          FAQs
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm">
        <p className="text-gray-500">
          Custom answers Layla reads aloud when callers ask off-script
          questions — payment methods, parking, insurance, cancellation
          policy, gift cards, sister-clinic locations. Anything not
          already covered by your services, hours, or address.
        </p>
        <Link
          href="/settings/faqs"
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
        >
          Manage FAQs
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </CardContent>
    </Card>
  )
}
