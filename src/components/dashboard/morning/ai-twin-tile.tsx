'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Sparkles, ArrowUpRight, ArrowDownRight, ArrowRight } from 'lucide-react'

/**
 * AI Twin metrics tile — single card between the action grid and the
 * schedule rail. Mirrors the lazy-load pattern from analytics-sections:
 * an IntersectionObserver sentinel keeps the fetch off the critical
 * path so the dashboard hot mount stays cheap.
 *
 * Refreshes on tab focus so the numbers feel live without the cost of
 * a poll loop.
 */

interface PeriodCounts {
  drafts_generated_this_week: number
  sent_unchanged_count: number
  sent_edited_count: number
  rejected_count: number
  guardrail_failed_count: number
}

interface RecentRejected {
  id: string
  draft_body_preview: string
  rejection_reason: string | null
  generated_at: string
}

interface Metrics extends PeriodCounts {
  average_edit_distance: number
  estimated_hours_saved: number
  top_5_recent_rejected: RecentRejected[]
  previous: PeriodCounts
}

function Skeleton() {
  return (
    <section className="rounded-2xl bg-[#FAF6EC] border border-[#02C39A]/15 p-5 animate-pulse">
      <div className="h-3 w-32 rounded bg-[#0B2027]/8" />
      <div className="mt-3 h-7 w-72 rounded bg-[#0B2027]/8" />
      <div className="mt-5 grid grid-cols-3 gap-3">
        <div className="h-16 rounded-lg bg-[#0B2027]/5" />
        <div className="h-16 rounded-lg bg-[#0B2027]/5" />
        <div className="h-16 rounded-lg bg-[#0B2027]/5" />
      </div>
    </section>
  )
}

function deltaLabel(curr: number, prev: number): { text: string; dir: 'up' | 'down' | 'flat' } {
  const d = curr - prev
  if (d === 0) return { text: 'no change', dir: 'flat' }
  return { text: `${d > 0 ? '+' : ''}${d} vs last week`, dir: d > 0 ? 'up' : 'down' }
}

export function AiTwinTile() {
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Lazy-load gate. Identical pattern to analytics-sections.tsx.
  const [visible, setVisible] = useState(false)
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (visible) return
    const el = sentinelRef.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }
    const obs = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting) {
          setVisible(true)
          obs.disconnect()
        }
      },
      { rootMargin: '300px 0px' },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [visible])

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    if (!silent) setError(null)
    try {
      const res = await fetch('/api/dashboard/ai-twin-metrics', { cache: 'no-store' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      const json = (await res.json()) as Metrics
      setMetrics(json)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load AI Twin metrics'
      console.error('[ai-twin-tile] load error:', err)
      if (!silent) setError(msg)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!visible) return
    load()
  }, [visible, load])

  // Pause/resume on tab visibility — refresh-on-focus only (no polling).
  useEffect(() => {
    if (!visible) return
    const onVis = () => { if (!document.hidden) load(true) }
    const onFocus = () => load(true)
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', onFocus)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('focus', onFocus)
    }
  }, [visible, load])

  if (!visible && !metrics) {
    return <div ref={sentinelRef} className="h-1" aria-hidden />
  }
  if (loading && !metrics) return <Skeleton />
  if (error) {
    return (
      <section className="rounded-2xl bg-[#FAF6EC] border border-[#B5710F]/25 p-4">
        <p className="text-[12.5px] font-medium text-[#B5710F]">AI Twin metrics unavailable</p>
        <p className="text-[11.5px] text-[#7E8C90] mt-0.5">{error}</p>
      </section>
    )
  }
  if (!metrics) return null

  const total = metrics.drafts_generated_this_week
  const headline = total === 1 ? '1 draft handled this week' : `${total} drafts handled this week`
  const delta = deltaLabel(total, metrics.previous.drafts_generated_this_week)
  // Blocked drafts are an internal-quality signal — render '—' when
  // none failed so the tile doesn't alarm clinic owners over nothing.
  const blockedLabel = metrics.guardrail_failed_count === 0
    ? '—'
    : String(metrics.guardrail_failed_count)

  return (
    <section className="rounded-2xl bg-[#FAF6EC] border border-[#02C39A]/20 px-5 py-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[#02C39A]/15">
            <Sparkles className="h-3.5 w-3.5 text-[#02C39A]" />
          </span>
          <p className="text-[11px] font-bold uppercase tracking-wide text-[#14241D]/55">
            AI front-desk twin
          </p>
        </div>
        <Link
          href="/ai-drafts/review"
          className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#02C39A] hover:text-[#04B08C]"
        >
          Review drafts
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      <h3
        className="mt-3 text-[#14241D]"
        style={{
          fontFamily: 'var(--font-newsreader), Newsreader, Georgia, serif',
          fontSize: '24px',
          fontWeight: 600,
          lineHeight: 1.1,
        }}
      >
        {headline}
      </h3>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <Cell label="Sent unchanged" value={metrics.sent_unchanged_count} tone="mint" />
        <Cell
          label="Edited"
          value={metrics.sent_edited_count}
          sub={metrics.sent_edited_count > 0 ? `~${metrics.average_edit_distance} char edits` : null}
          tone="teal"
        />
        <Cell label="Rejected" value={metrics.rejected_count} tone="amber" />
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[12.5px]">
        <p className="text-[#14241D]/75">
          Estimated <span className="font-semibold text-[#14241D]">~{metrics.estimated_hours_saved}h</span> saved
        </p>
        <div className="flex items-center gap-3">
          <span className="text-[#7E8C90]">
            Blocked: <span className="font-semibold text-[#14241D]/80">{blockedLabel}</span>
          </span>
          <span
            className={
              delta.dir === 'up'
                ? 'inline-flex items-center gap-1 text-[#04B08C] font-medium'
                : delta.dir === 'down'
                ? 'inline-flex items-center gap-1 text-[#B5710F] font-medium'
                : 'inline-flex items-center gap-1 text-[#7E8C90] font-medium'
            }
          >
            {delta.dir === 'up' && <ArrowUpRight className="h-3 w-3" />}
            {delta.dir === 'down' && <ArrowDownRight className="h-3 w-3" />}
            {delta.text}
          </span>
        </div>
      </div>
    </section>
  )
}

interface CellProps {
  label: string
  value: number
  sub?: string | null
  tone: 'mint' | 'teal' | 'amber'
}

function Cell({ label, value, sub, tone }: CellProps) {
  const accent =
    tone === 'mint'  ? '#02C39A' :
    tone === 'teal'  ? '#028090' :
                       '#B5710F'
  return (
    <div className="rounded-lg bg-white/60 border border-[#0B2027]/8 px-3 py-2.5">
      <p className="text-[10.5px] font-semibold uppercase tracking-wide text-[#14241D]/55">{label}</p>
      <p className="mt-1 text-[20px] font-semibold text-[#14241D]" style={{ lineHeight: 1 }}>
        {value}
        <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ backgroundColor: accent }} />
      </p>
      {sub && <p className="mt-0.5 text-[10.5px] text-[#7E8C90]">{sub}</p>}
    </div>
  )
}
