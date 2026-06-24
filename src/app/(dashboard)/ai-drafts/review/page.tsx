'use client'
import { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Sparkles, ChevronLeft, ChevronRight, ArrowRight } from 'lucide-react'
import { ContactAvatar } from '@/components/leads/contact-avatar'
import { FlagDraftButton } from '@/components/ai-twin/flag-draft-button'
import { cn } from '@/lib/utils'

/**
 * /ai-drafts/review — audit surface for every AI draft the twin has
 * produced. No polling: this is a "look back" page. Pagination + state
 * filter live in the URL so the back button works.
 */

type FilterState = 'all' | 'sent' | 'edited' | 'rejected' | 'blocked' | 'auto_sent'

type DraftStateCol =
  | 'pending'
  | 'sent'
  | 'edited'
  | 'rejected'
  | 'expired'
  | 'guardrail_failed'
  | 'auto_sent'

interface DraftRow {
  id: string
  contact_id: string
  contact_first_name: string | null
  contact_last_name: string | null
  draft_body: string
  sent_message_body: string | null
  edit_distance: number | null
  rejection_reason: string | null
  guardrail_violation: string | null
  state: DraftStateCol
  generated_at: string
  resolved_at: string | null
}

interface DraftListResponse {
  rows: DraftRow[]
  total: number
  page: number
  page_size: number
}

const FILTERS: { key: FilterState; label: string }[] = [
  { key: 'all',      label: 'All'      },
  { key: 'sent',     label: 'Sent'     },
  { key: 'edited',   label: 'Edited'   },
  { key: 'rejected', label: 'Rejected' },
  { key: 'blocked',  label: 'Blocked'  },
]

// Friendly labels for the machine rule names the guardrails emit. Raw
// rule keys leak internal vocabulary; rename them here.
const GUARDRAIL_LABEL: Record<string, string> = {
  quoted_price:            'Quoted a price',
  quoted_dose:             'Quoted a medical dose',
  promised_outcome:        'Promised an outcome',
  named_provider:          'Named a specific provider',
  committed_calendar_slot: 'Committed to a calendar slot',
  discount_offered:        'Offered a discount',
}

function isFilterState(v: string | null): v is FilterState {
  return v === 'all' || v === 'sent' || v === 'edited' || v === 'rejected' || v === 'blocked'
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  if (diffMs < 60_000) return 'just now'
  const m = Math.floor(diffMs / 60_000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  const w = Math.floor(d / 7)
  if (w < 5) return `${w}w ago`
  const mo = Math.floor(d / 30)
  return `${mo}mo ago`
}

function ReviewPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const rawState = searchParams.get('state')
  const filter: FilterState = isFilterState(rawState) ? rawState : 'all'
  const pageRaw = Number(searchParams.get('page') ?? '0')
  const page = Number.isFinite(pageRaw) && pageRaw >= 0 ? Math.floor(pageRaw) : 0

  const [data, setData] = useState<DraftListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const url = `/api/ai-drafts/list?state=${filter}&page=${page}`
      const res = await fetch(url, { cache: 'no-store' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      const json = (await res.json()) as DraftListResponse
      setData(json)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load drafts'
      console.error('[ai-drafts/review] load error:', err)
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [filter, page])

  useEffect(() => { load() }, [load])

  function setFilter(next: FilterState) {
    const sp = new URLSearchParams()
    if (next !== 'all') sp.set('state', next)
    // switching filters always resets to page 0
    const qs = sp.toString()
    router.push(qs ? `/ai-drafts/review?${qs}` : '/ai-drafts/review')
  }

  function setPage(next: number) {
    const sp = new URLSearchParams()
    if (filter !== 'all') sp.set('state', filter)
    if (next > 0) sp.set('page', String(next))
    const qs = sp.toString()
    router.push(qs ? `/ai-drafts/review?${qs}` : '/ai-drafts/review')
  }

  const total = data?.total ?? 0
  const pageSize = data?.page_size ?? 50
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const rangeFrom = total === 0 ? 0 : page * pageSize + 1
  const rangeTo = total === 0 ? 0 : Math.min(total, (page + 1) * pageSize)

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Page-local top bar matches the dashboard pattern. */}
      <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-[#02C39A]/35 bg-[#F5EFE1] px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <span className="inline-flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[10px] bg-[#02C39A]/15">
            <Sparkles className="h-5 w-5 text-[#02C39A]" />
          </span>
          <div className="min-w-0">
            <p className="text-[12px] font-medium text-[#4A5A60]">AI Twin</p>
            <p
              className="text-[#14241D]"
              style={{
                fontFamily: 'var(--font-newsreader), Newsreader, Georgia, serif',
                fontSize: '22px',
                fontWeight: 600,
                lineHeight: 1,
              }}
            >
              AI draft review
            </p>
          </div>
        </div>
        <Link
          href="/dashboard"
          className="text-[12.5px] font-medium text-[#14241D]/70 hover:text-[#14241D]"
        >
          Back to dashboard
        </Link>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-6 sm:px-10 sm:py-7">
        <div className="mx-auto flex max-w-[1100px] flex-col gap-5">
          {/* Filter chips */}
          <div className="flex flex-wrap items-center gap-2">
            {FILTERS.map(({ key, label }) => {
              const active = filter === key
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFilter(key)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12.5px] font-medium transition-colors',
                    active
                      ? 'bg-[#0B2027] text-[#FAF6EC]'
                      : 'bg-white text-[#0B2027]/75 border border-[#0B2027]/12 hover:bg-[#0B2027]/4',
                  )}
                >
                  {label}
                </button>
              )
            })}
            <span className="ml-auto text-[12px] text-[#7E8C90]">
              {total === 0
                ? 'No drafts for this filter'
                : `${rangeFrom}-${rangeTo} of ${total}`}
            </span>
          </div>

          {/* Rows */}
          {loading && !data ? (
            <ListSkeleton />
          ) : error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
              <p className="text-sm font-medium text-red-700">Failed to load drafts</p>
              <p className="text-xs text-red-500 mt-0.5">{error}</p>
            </div>
          ) : data && data.rows.length === 0 ? (
            <div className="rounded-2xl border border-[#0B2027]/10 bg-[#FAF6EC] px-5 py-10 text-center">
              <p className="text-[13px] text-[#14241D]/65">No drafts yet for this filter.</p>
            </div>
          ) : data ? (
            <div className="flex flex-col gap-2.5">
              {data.rows.map(row => (
                <DraftCard key={row.id} row={row} />
              ))}
            </div>
          ) : null}

          {/* Pagination */}
          {data && total > pageSize && (
            <div className="mt-2 flex items-center justify-between gap-3">
              <button
                type="button"
                disabled={page <= 0}
                onClick={() => setPage(page - 1)}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[12.5px] font-medium border transition-colors',
                  page <= 0
                    ? 'border-[#0B2027]/10 text-[#0B2027]/30 cursor-not-allowed'
                    : 'border-[#0B2027]/12 text-[#14241D]/75 hover:bg-[#0B2027]/4',
                )}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Previous
              </button>
              <span className="text-[12px] text-[#7E8C90]">
                Page {page + 1} of {totalPages}
              </span>
              <button
                type="button"
                disabled={page + 1 >= totalPages}
                onClick={() => setPage(page + 1)}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[12.5px] font-medium border transition-colors',
                  page + 1 >= totalPages
                    ? 'border-[#0B2027]/10 text-[#0B2027]/30 cursor-not-allowed'
                    : 'border-[#0B2027]/12 text-[#14241D]/75 hover:bg-[#0B2027]/4',
                )}
              >
                Next
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function ReviewPage() {
  // useSearchParams requires a Suspense boundary in this Next version.
  return (
    <Suspense fallback={<div className="p-8 text-[12.5px] text-[#7E8C90]">Loading…</div>}>
      <ReviewPageInner />
    </Suspense>
  )
}

function DraftCard({ row }: { row: DraftRow }) {
  const name = `${row.contact_first_name ?? ''} ${row.contact_last_name ?? ''}`.trim() || 'Unknown'
  const stateBadge = stateBadgeProps(row.state)
  return (
    <article className="rounded-2xl bg-[#FAF6EC] border border-[#0B2027]/8 px-4 py-3.5">
      <div className="flex items-start gap-3">
        <ContactAvatar
          firstName={row.contact_first_name}
          lastName={row.contact_last_name}
          size="md"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/leads/${row.contact_id}`}
              className="text-[14px] font-semibold text-[#14241D] hover:text-[#02C39A]"
            >
              {name}
            </Link>
            <span
              className="inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide"
              style={{ backgroundColor: stateBadge.bg, color: stateBadge.fg }}
            >
              {stateBadge.label}
            </span>
            {row.state === 'edited' && row.edit_distance != null && (
              <span className="inline-flex items-center rounded-full bg-[#028090]/15 px-2 py-0.5 text-[10.5px] font-semibold text-[#028090]">
                {row.edit_distance} char{row.edit_distance === 1 ? '' : 's'} edited
              </span>
            )}
            {row.state === 'auto_sent' && (
              <FlagDraftButton draftId={row.id} alreadyFlagged={false} size="sm" />
            )}
            <span className="ml-auto text-[11.5px] text-[#7E8C90]">
              {relativeTime(row.generated_at)}
            </span>
          </div>

          {/* Draft body */}
          <p className="mt-2 text-[12.5px] text-[#14241D]/80 line-clamp-2">
            <span className="font-semibold text-[#14241D]/60 mr-1">Draft:</span>
            {row.draft_body || <span className="italic text-[#7E8C90]">empty</span>}
          </p>

          {/* What was actually sent — only relevant when the draft made it out. */}
          {(row.state === 'sent' || row.state === 'edited') && (
            <p className="mt-1.5 text-[12.5px] text-[#14241D]/80 line-clamp-2">
              <span className="font-semibold text-[#02C39A] mr-1 inline-flex items-center gap-0.5">
                Sent <ArrowRight className="h-3 w-3" />
              </span>
              {row.sent_message_body ?? <span className="italic text-[#7E8C90]">—</span>}
            </p>
          )}

          {/* Rejection / guardrail context in amber. */}
          {row.state === 'rejected' && row.rejection_reason && (
            <p className="mt-1.5 text-[12px] text-[#B5710F]">
              Rejected: {row.rejection_reason}
            </p>
          )}
          {row.state === 'guardrail_failed' && row.guardrail_violation && (
            <p className="mt-1.5 text-[12px] text-[#B5710F]">
              Blocked: {GUARDRAIL_LABEL[row.guardrail_violation] ?? row.guardrail_violation}
            </p>
          )}
        </div>
      </div>
    </article>
  )
}

function stateBadgeProps(state: DraftStateCol): { label: string; bg: string; fg: string } {
  switch (state) {
    case 'sent':             return { label: 'Sent',       bg: '#02C39A22', fg: '#04B08C' }
    case 'edited':           return { label: 'Edited',     bg: '#02809022', fg: '#026B78' }
    case 'auto_sent':        return { label: 'Auto-sent',  bg: '#02809033', fg: '#028090' }
    case 'rejected':         return { label: 'Rejected',   bg: '#B5710F22', fg: '#B5710F' }
    case 'guardrail_failed': return { label: 'Blocked',    bg: '#B5710F22', fg: '#B5710F' }
    case 'expired':          return { label: 'Expired',    bg: '#0B202714', fg: '#14241D' }
    case 'pending':          return { label: 'Pending',    bg: '#0B202714', fg: '#14241D' }
  }
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-2.5 animate-pulse">
      {[0, 1, 2, 3].map(i => (
        <div key={i} className="h-24 rounded-2xl bg-[#0B2027]/5" />
      ))}
    </div>
  )
}
