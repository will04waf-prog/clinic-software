'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Plus, Sun } from 'lucide-react'
import { BriefHero } from '@/components/dashboard/morning/brief-hero'
import { WaitingHero } from '@/components/dashboard/morning/waiting-hero'
import { ActionStack } from '@/components/dashboard/morning/action-stack'
import { UpNextCard } from '@/components/dashboard/morning/up-next-card'
import { NudgeCard } from '@/components/dashboard/morning/nudge-card'
import { ScheduleRail } from '@/components/dashboard/morning/schedule-rail'
import { WeekStrip } from '@/components/dashboard/morning/week-strip'
import { AnalyticsSections } from '@/components/dashboard/analytics/analytics-sections'
import type { MorningResponse } from '@/components/dashboard/morning/types'

const POLL_INTERVAL_MS = 60_000

function DashboardSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-10 w-80 rounded bg-[#0B2027]/5" />
      <div className="h-32 rounded-2xl bg-[#0B2027]/5" />
      <div className="grid gap-6 lg:grid-cols-[1.72fr_1fr]">
        <div className="space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-24 rounded-[14px] bg-[#0B2027]/5" />
          ))}
        </div>
        <div className="space-y-4">
          <div className="h-56 rounded-2xl bg-[#0B2027]/5" />
          <div className="h-32 rounded-2xl bg-[#02C39A]/5" />
        </div>
      </div>
    </div>
  )
}

/**
 * Dashboard "Morning Briefing" — the new home screen.
 *
 * Six panels, all reading from a single /api/dashboard/morning fetch:
 *   1. Hero — AI brief sentence (default) or big "waiting count"
 *      (?hero=waiting). Visual placeholders for now; same shape as
 *      the eventual LLM response.
 *   2. Action stack — ranked triage queue (now/today/cool/auto). The
 *      centerpiece — every row is a single thing the clinic should
 *      do right now.
 *   3. Up-Next card — soonest consult today as a forest anchor.
 *   4. AI nudge — one insight, rule-based. Dismissible per-session.
 *   5. Schedule rail — today's consults with open-slot tiles between.
 *   6. Week strip — compressed KPI pulse (3 cells; revenue deferred).
 *
 * Polls once a minute so the action stack feels alive without slamming
 * the server. The inbox at /leads is the higher-frequency surface.
 */
export default function DashboardPage() {
  const searchParams = useSearchParams()
  const heroVariant = searchParams.get('hero') === 'waiting' ? 'waiting' : 'brief'

  const [data, setData] = useState<MorningResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    if (!silent) setError(null)
    try {
      const res = await fetch('/api/dashboard/morning', { cache: 'no-store' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      const json = (await res.json()) as MorningResponse
      setData(json)
    } catch (err: any) {
      console.error('[dashboard/morning] load error:', err)
      if (!silent) setError(err.message ?? 'Failed to load dashboard')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null
    const start = () => {
      if (intervalId !== null) return
      intervalId = setInterval(() => load(true), POLL_INTERVAL_MS)
    }
    const stop = () => {
      if (intervalId === null) return
      clearInterval(intervalId)
      intervalId = null
    }
    const onVis = () => { if (document.hidden) stop(); else { load(true); start() } }
    const onFocus = () => load(true)
    if (!document.hidden) start()
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', onFocus)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('focus', onFocus)
    }
  }, [load])

  const dateLabel = useMemo(() => {
    return new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    })
  }, [])
  const clockLabel = useMemo(() => {
    return new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  }, [data?.generatedAt])

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Page-local top bar. The mockup's "Today / Tuesday, June 23 / 9:20
          AM" with a sun-horizon icon and right-side actions. We don't
          touch the shared <Header> (used by every other page) — this is
          a dashboard-only widget that takes its place. */}
      <header className="flex min-h-[76px] items-center justify-between gap-3 border-b border-[#0B2027]/8 bg-white px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <span className="inline-flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[10px] bg-[#02C39A]/15">
            <Sun className="h-5 w-5 text-[#028090]" fill="currentColor" />
          </span>
          <div className="min-w-0">
            <p className="text-[12px] font-medium text-[#4A5A60]">Today</p>
            <p className="whitespace-nowrap">
              <span
                className="text-[#14241D]"
                style={{
                  fontFamily: 'var(--font-newsreader), Newsreader, Georgia, serif',
                  fontSize: '22px',
                  fontWeight: 600,
                  lineHeight: 1,
                }}
              >
                {dateLabel}
              </span>
              <span className="ml-2 text-[15px] text-[#A4AFB2]">{clockLabel}</span>
            </p>
          </div>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {/* Search + bell intentionally omitted — they were stubs.
              When real search and notifications ship, restore them here. */}
          <Link
            href="/leads"
            className="inline-flex items-center gap-1.5 rounded-full bg-[#028090] px-4 py-2 text-[13px] font-semibold text-white shadow-[0_2px_6px_-2px_rgba(2,128,144,0.5)] hover:bg-[#026B78] transition-colors"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2.6} />
            Add lead
          </Link>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-6 sm:px-10 sm:py-7" style={{ scrollBehavior: 'smooth' }}>
        <div className="mx-auto flex max-w-[1240px] flex-col gap-7">
          {loading && !data ? (
            <DashboardSkeleton />
          ) : error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
              <p className="text-sm font-medium text-red-700">Failed to load dashboard</p>
              <p className="text-xs text-red-500 mt-0.5">{error}</p>
            </div>
          ) : data ? (
            <>
              {/* ① Hero */}
              {heroVariant === 'waiting' ? (
                <WaitingHero waiting={data.waiting} generatedAt={data.generatedAt} />
              ) : (
                <BriefHero brief={data.brief} generatedAt={data.generatedAt} />
              )}

              {/* ② Two-column grid: action stack | up-next + nudge */}
              <div className="grid gap-6 lg:grid-cols-[1.72fr_1fr]">
                <ActionStack actions={data.actions} />
                <div className="flex flex-col gap-4">
                  <UpNextCard upNext={data.upNext} />
                  <NudgeCard nudge={data.nudge} />
                </div>
              </div>

              {/* ③ Schedule rail */}
              <ScheduleRail schedule={data.schedule} dateLabel={dateLabel} />

              {/* ④ Week strip */}
              <WeekStrip week={data.week} />

              {/* ⑤ Performance divider + analytics sections.
                  /analytics no longer exists as a separate route — the
                  trend chart, funnel, and source breakdown live here
                  inline. The "See analytics" link in the week strip
                  scrolls to #performance below. */}
              <div id="performance" className="mt-2 flex items-center gap-4 pt-4 border-t border-[#0B2027]/8 scroll-mt-24">
                <h2
                  className="text-[#14241D]"
                  style={{
                    fontFamily: 'var(--font-newsreader), Newsreader, Georgia, serif',
                    fontSize: '26px',
                    fontWeight: 600,
                    lineHeight: 1,
                  }}
                >
                  Performance
                </h2>
                <span className="text-[12.5px] text-[#7E8C90]">
                  How leads flow through your funnel
                </span>
              </div>

              <AnalyticsSections />
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}
