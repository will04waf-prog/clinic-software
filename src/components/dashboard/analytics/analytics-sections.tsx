'use client'
import { useCallback, useEffect, useState } from 'react'
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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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

  useEffect(() => { load(range) }, [load, range])

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
