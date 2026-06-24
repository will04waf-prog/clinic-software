'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { TrendChart, type AnalyticsRange, type TimeseriesPoint } from './trend-chart'
import { FunnelStrip } from './funnel-strip'
import { SourceBreakdown } from './source-breakdown'
import type { LeadSource } from '@/types'

interface AnalyticsResponse {
  range: AnalyticsRange
  days: number
  totalContacts: number
  timeseries: TimeseriesPoint[]
  funnel: { key: string; label: string; value: number; sub: string }[]
  sources: { key: LeadSource | 'unknown'; count: number }[]
}

function SectionsSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-72 rounded-2xl bg-[#0B2027]/5" />
      <div className="h-40 rounded-2xl bg-[#0B2027]/5" />
      <div className="h-56 rounded-2xl bg-[#0B2027]/5" />
    </div>
  )
}

/**
 * The three analytics sections (trend chart, funnel, source
 * breakdown), loaded client-side from /api/dashboard/analytics.
 *
 * Lives in its own component so the parent dashboard page can drop
 * it in below the morning briefing without re-implementing the fetch
 * + range state. The range param drives a fresh fetch each time.
 */
export function AnalyticsSections() {
  const [range, setRange] = useState<AnalyticsRange>('30d')
  const [data, setData] = useState<AnalyticsResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Lazy-load gate: stays false until the section nears the viewport.
  // This stops the heavy /api/dashboard/analytics call from happening
  // on dashboard mount — the user only pays for it if they actually
  // scroll down to Performance.
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
      (entries) => {
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

  const load = useCallback(async (r: AnalyticsRange) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/dashboard/analytics?range=${r}`, { cache: 'no-store' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      const json = (await res.json()) as AnalyticsResponse
      setData(json)
    } catch (err: any) {
      console.error('[analytics] load error:', err)
      setError(err.message ?? 'Failed to load analytics')
    } finally {
      setLoading(false)
    }
  }, [])

  // Fetch only after the section enters (or nears) the viewport.
  // Re-fetches on range change as before.
  useEffect(() => {
    if (!visible) return
    load(range)
  }, [visible, load, range])

  // Sentinel rendered even when nothing else is — gives the
  // IntersectionObserver something to watch.
  if (!visible && !data) {
    return <div ref={sentinelRef} className="h-1" aria-hidden />
  }
  if (loading && !data) return <SectionsSkeleton />
  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
        <p className="text-sm font-medium text-red-700">Failed to load analytics</p>
        <p className="text-xs text-red-500 mt-0.5">{error}</p>
      </div>
    )
  }
  if (!data) return null

  return (
    <div className="flex flex-col gap-7">
      <TrendChart data={data.timeseries} range={range} onRangeChange={setRange} />
      <FunnelStrip funnel={data.funnel} days={data.days} />
      <SourceBreakdown
        sources={data.sources}
        totalContacts={data.totalContacts}
        days={data.days}
      />
    </div>
  )
}
