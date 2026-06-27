/**
 * Phase 5 W2 — /settings/faqs.
 *
 * Owner-only. Per-org FAQ editor backing organizations.faqs jsonb
 * (added in 20260713100000_add_org_faqs.sql). The corpus feeds
 * Layla's lookup_faq voice tool, which fires when the caller asks
 * something Layla doesn't have a dedicated tool for (parking,
 * insurance, gift cards, cancellation policy, sister-clinic
 * locations, deposit policy, etc.).
 *
 * The page is intentionally separate from /settings/call-agent —
 * FAQs aren't a "voice agent setting", they're content the agent
 * reads, and lumping the editor into the agent's configuration
 * page makes the latter long enough to drown the toggles. A link
 * card on the main /settings page is the entry point.
 *
 * Tier note: lookup_faq runs whenever the call agent is enabled,
 * which is itself Scale-only. We don't gate this editor behind
 * Scale — owners on a lower plan can pre-author their corpus
 * before they upgrade. The voice tool refuses with
 * "voice agent is not enabled" on its own.
 */

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { Header } from '@/components/layout/header'
import { FaqList } from '@/components/settings/faqs/faq-list'
import type { FaqRow } from './actions'

export default async function FaqsSettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Owner-only — defense in depth. The server actions also re-check.
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, organization_id')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'owner') redirect('/settings')
  if (!profile.organization_id) redirect('/settings')

  // Read via supabaseAdmin (mirrors how the server actions write) so
  // the page renders the same row the actions will mutate, even
  // under a future RLS policy that narrows org-row reads.
  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('faqs')
    .eq('id', profile.organization_id)
    .single()

  // Defensive shape coercion. The DB enforces array-ness via the
  // organizations_faqs_max_count CHECK + the not-null default, but
  // belt and braces — a malformed entry should silently drop, not
  // 500 the settings page.
  const initial: FaqRow[] = Array.isArray(org?.faqs)
    ? (org!.faqs as unknown[])
        .filter((r): r is FaqRow => {
          if (!r || typeof r !== 'object') return false
          const o = r as Record<string, unknown>
          return typeof o.id === 'string'
            && typeof o.question === 'string'
            && typeof o.answer === 'string'
            && typeof o.position === 'number'
        })
        // Tags are optional in storage; normalize to [] for the client.
        .map((r) => ({
          ...r,
          tags: Array.isArray(r.tags)
            ? (r.tags.filter((t) => typeof t === 'string') as string[])
            : [],
        }))
        .sort((a, b) => a.position - b.position)
    : []

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header
        title="FAQs"
        subtitle="Custom answers Layla reads aloud when callers ask off-script questions"
      />
      <div className="flex-1 overflow-y-auto p-6 space-y-4 max-w-3xl">
        <Link
          href="/settings"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-brand-700"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to settings
        </Link>

        <div className="rounded-md border border-brand-200 bg-brand-50 px-3 py-2 text-xs text-brand-700">
          Layla already knows your hours, services, prep instructions,
          and clinic address from other settings. Use FAQs for
          everything else — payment methods, insurance, parking,
          cancellation policy, gift cards, sister-clinic locations, and
          anything you'd otherwise have her take a message about.
        </div>

        <FaqList initial={initial} />
      </div>
    </div>
  )
}
