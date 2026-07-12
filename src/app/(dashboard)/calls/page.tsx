/**
 * Phase 5 W2 hardening — call log index.
 *
 * Owner-only list of recent voice calls. The motivating bug: until
 * the serverMessages fix (commit b047095) call_logs was empty across
 * every org — no surface in the dashboard ever showed an owner
 * "you've placed/received 50 calls and none of them logged." This
 * page is the canary. If it's empty for a week while the agent is
 * live, something's wrong upstream and the owner will notice.
 *
 * Filtering / pagination: kept minimal for V1. 50 rows per page,
 * direction filter, outcome filter. The single-call detail page at
 * /calls/[sid] handles deep inspection.
 */

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Phone, PhoneIncoming, PhoneOutgoing, ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Header } from '@/components/layout/header'
import { Card, CardContent } from '@/components/ui/card'
import { CallLanguageBadge } from '@/components/calls/call-language-badge'

const PAGE_SIZE = 50

const OUTCOME_LABEL: Record<string, string> = {
  completed:       'Completed',
  transferred:     'Transferred',
  voicemail:       'Voicemail',
  safety_handoff:  'Safety handoff',
  no_consent:      'No consent',
  agent_error:     'Agent error',
}

const OUTCOME_BADGE: Record<string, string> = {
  completed:       'bg-emerald-50 text-emerald-700 border-emerald-200',
  transferred:     'bg-amber-50  text-amber-700  border-amber-200',
  voicemail:       'bg-gray-50   text-gray-700   border-gray-200',
  safety_handoff:  'bg-red-50    text-red-700    border-red-200',
  no_consent:      'bg-orange-50 text-orange-700 border-orange-200',
  agent_error:     'bg-red-50    text-red-700    border-red-200',
}

function formatPhone(raw: string | null): string {
  if (!raw) return 'unknown'
  const digits = raw.replace(/\D/g, '').slice(-10)
  if (digits.length !== 10) return raw
  return `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`
}

function formatDuration(sec: number | null): string {
  if (sec == null) return '—'
  if (sec < 60) return `${sec}s`
  const m = Math.floor(sec / 60), s = sec % 60
  return s === 0 ? `${m}m` : `${m}m ${s}s`
}

export default async function CallsIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; direction?: 'inbound' | 'outbound' }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, is_active, organization_id')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'owner' || profile?.is_active !== true) redirect('/dashboard')

  const params    = await searchParams
  const page      = Math.max(0, Number(params.page ?? '0') | 0)
  const direction = params.direction === 'inbound' || params.direction === 'outbound'
    ? params.direction
    : null

  let query = supabase
    .from('call_logs')
    .select('id, call_sid, direction, from_e164, to_e164, started_at, ended_at, duration_sec, outcome, intent, detected_language, is_urgent, urgency_reason, contact:contacts!call_logs_contact_id_fkey(id, first_name, last_name)', { count: 'exact' })
    .eq('organization_id', profile.organization_id as string)
    .order('started_at', { ascending: false, nullsFirst: false })
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)

  if (direction) query = query.eq('direction', direction)

  const { data: calls, count } = await query

  const total = count ?? 0
  const showingFrom = total === 0 ? 0 : page * PAGE_SIZE + 1
  const showingTo   = Math.min((page + 1) * PAGE_SIZE, total)

  function buildHref(next: { page?: number; direction?: 'inbound' | 'outbound' | null }) {
    const u = new URLSearchParams()
    const p = next.page ?? page
    const d = next.direction === undefined ? direction : next.direction
    if (p > 0) u.set('page', String(p))
    if (d) u.set('direction', d)
    const qs = u.toString()
    return qs ? `/calls?${qs}` : '/calls'
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header
        title="Call log"
        subtitle="Every voice call your AI agent has handled, newest first."
      />
      <div className="flex-1 overflow-y-auto p-6 space-y-4 max-w-5xl">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-[#02C39A] transition"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to dashboard
        </Link>

        {/* Filter chips */}
        <div className="flex items-center gap-2 text-xs">
          <FilterChip active={!direction}                href={buildHref({ direction: null,       page: 0 })} label="All" />
          <FilterChip active={direction === 'inbound'}   href={buildHref({ direction: 'inbound',  page: 0 })} label="Inbound" />
          <FilterChip active={direction === 'outbound'}  href={buildHref({ direction: 'outbound', page: 0 })} label="Outbound" />
          <span className="ml-auto text-gray-500">
            {total === 0 ? 'No calls yet.' : `${showingFrom}–${showingTo} of ${total}`}
          </span>
        </div>

        {!calls || calls.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-sm text-gray-500 flex items-center gap-2">
              <Phone className="h-4 w-4" />
              {total === 0
                ? "No calls logged yet. Calls will appear here once the AI agent handles them."
                : "No calls match this filter."}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-xs text-gray-500 text-left">
                    <th className="px-4 py-2.5 font-medium w-8"></th>
                    <th className="px-4 py-2.5 font-medium">From</th>
                    <th className="px-4 py-2.5 font-medium">When</th>
                    <th className="px-4 py-2.5 font-medium">Duration</th>
                    <th className="px-4 py-2.5 font-medium">Outcome</th>
                    <th className="px-4 py-2.5 font-medium">Language</th>
                    <th className="px-4 py-2.5 font-medium">Intent</th>
                  </tr>
                </thead>
                <tbody>
                  {calls.map((c) => {
                    const contact = Array.isArray(c.contact) ? c.contact[0] : c.contact
                    const displayName = contact?.first_name
                      ? `${contact.first_name} ${contact.last_name ?? ''}`.trim()
                      : null
                    const phone = c.direction === 'inbound' ? c.from_e164 : c.to_e164
                    const when = c.started_at
                      ? new Date(c.started_at).toLocaleString('en-US', {
                          month: 'short', day: 'numeric',
                          hour: 'numeric', minute: '2-digit', hour12: true,
                        })
                      : '—'
                    const outcomeBadge = c.outcome
                      ? `inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${OUTCOME_BADGE[c.outcome] ?? 'bg-gray-50 text-gray-700 border-gray-200'}`
                      : ''
                    return (
                      <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition">
                        <td className="px-4 py-2.5">
                          {c.direction === 'outbound'
                            ? <PhoneOutgoing className="h-3.5 w-3.5 text-gray-400" />
                            : <PhoneIncoming className="h-3.5 w-3.5 text-gray-400" />}
                        </td>
                        <td className="px-4 py-2.5">
                          <Link href={`/calls/${encodeURIComponent(c.call_sid)}`} className="block hover:text-[#02C39A]">
                            <div className="font-medium text-gray-900">{displayName ?? formatPhone(phone)}</div>
                            {displayName && (
                              <div className="text-xs text-gray-500">{formatPhone(phone)}</div>
                            )}
                          </Link>
                        </td>
                        <td className="px-4 py-2.5 text-gray-600">{when}</td>
                        <td className="px-4 py-2.5 text-gray-600">{formatDuration(c.duration_sec)}</td>
                        <td className="px-4 py-2.5">
                          {c.outcome && (
                            <span className={outcomeBadge}>{OUTCOME_LABEL[c.outcome] ?? c.outcome}</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <CallLanguageBadge
                            detectedLanguage={c.detected_language}
                            isUrgent={c.is_urgent}
                            urgencyReason={c.urgency_reason}
                            variant="short"
                          />
                        </td>
                        <td className="px-4 py-2.5 text-gray-600">{c.intent ?? '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}

        {/* Pagination */}
        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between text-xs text-gray-500 pt-2">
            <Link
              href={buildHref({ page: Math.max(0, page - 1) })}
              className={page === 0 ? 'pointer-events-none opacity-40' : 'hover:text-[#02C39A]'}
              aria-disabled={page === 0}
            >
              ← Prev
            </Link>
            <span>Page {page + 1}</span>
            <Link
              href={buildHref({ page: page + 1 })}
              className={showingTo >= total ? 'pointer-events-none opacity-40' : 'hover:text-[#02C39A]'}
              aria-disabled={showingTo >= total}
            >
              Next →
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}

function FilterChip({ active, href, label }: { active: boolean; href: string; label: string }) {
  return (
    <Link
      href={href}
      className={
        active
          ? 'rounded-full border border-[#02C39A] bg-[#02C39A]/10 text-[#04B08C] px-3 py-1 font-medium'
          : 'rounded-full border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 px-3 py-1'
      }
    >
      {label}
    </Link>
  )
}
