'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Plus, Sun, CalendarDays, FileText } from 'lucide-react'
import { BriefHero } from '@/components/dashboard/morning/brief-hero'
import { WaitingHero } from '@/components/dashboard/morning/waiting-hero'
import { ActionStack } from '@/components/dashboard/morning/action-stack'
import { UpNextCard } from '@/components/dashboard/morning/up-next-card'
import { NudgeCard } from '@/components/dashboard/morning/nudge-card'
import { ScheduleRail } from '@/components/dashboard/morning/schedule-rail'
import { WeekStrip } from '@/components/dashboard/morning/week-strip'
import { AiTwinTile } from '@/components/dashboard/morning/ai-twin-tile'
import { AnalyticsSections } from '@/components/dashboard/analytics/analytics-sections'
import { SetupGuide } from '@/components/dashboard/setup-guide'
import { PhoneNumberBanner } from '@/components/onboarding/phone-number-banner'
import { LandscapingEmptyState } from '@/components/dashboard/landscaping-empty-state'
import { dict, resolveLocale, type Locale } from '@/lib/i18n'
import type { MorningResponse } from '@/components/dashboard/morning/types'

const POLL_INTERVAL_MS = 60_000

/**
 * Vertical-aware dashboard entry.
 *
 * The home screen serves two very different tenants now. Med-spa orgs
 * get the Layla-centric "Morning Briefing" below, byte-for-byte
 * unchanged. Landscaping (and any non-med-spa) orgs get the Spanish
 * loop empty-state instead — never the Layla setup guide, phone banner,
 * or morning briefing.
 *
 * We learn the vertical client-side from /api/jobs (the only
 * client-reachable endpoint that resolves the org's vertical + owner
 * context). Until it resolves we show a neutral gate so a landscaping
 * owner never flashes the med-spa surface. On any failure we fall back
 * to the med-spa dashboard — the existing tenants' unchanged behavior.
 */
export default function DashboardPage() {
  const [context, setContext] = useState<{
    vertical: string
    ownerLanguage: string
    ownerName: string | null
  } | null>(null)
  const [resolved, setResolved] = useState(false)

  useEffect(() => {
    let cancelled = false
    const fallback = { vertical: 'medspa', ownerLanguage: 'es', ownerName: null }
    fetch('/api/jobs', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => {
        if (cancelled) return
        setContext(b?.context ?? fallback)
        setResolved(true)
      })
      .catch(() => {
        if (cancelled) return
        setContext(fallback)
        setResolved(true)
      })
    return () => { cancelled = true }
  }, [])

  if (!resolved) return <VerticalGate />

  if (context && context.vertical !== 'medspa') {
    return (
      <LandscapingDashboard
        locale={resolveLocale(context.ownerLanguage)}
        ownerName={context.ownerName}
      />
    )
  }

  return <MedspaDashboard />
}

/** Neutral loading gate shown while the vertical resolves. */
function VerticalGate() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="h-16 shrink-0 border-b border-[#02C39A]/35 bg-[#F5EFE1]" />
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-[1240px] animate-pulse space-y-6">
          <div className="h-10 w-64 rounded bg-[#0B2027]/5" />
          <div className="h-32 rounded-2xl bg-[#0B2027]/5" />
        </div>
      </div>
    </div>
  )
}

/**
 * Landscaping (loop) home — the Spanish empty-state plus two quick
 * links into the loop's core surfaces. No Layla anything.
 */
function LandscapingDashboard({ locale, ownerName }: { locale: Locale; ownerName: string | null }) {
  const d = dict(locale).dashboard
  const job = dict(locale).job

  const quickLinks = [
    { href: '/schedule', label: job.scheduleTitle, icon: CalendarDays },
    { href: '/estimates', label: d.estimates, icon: FileText },
  ]

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-16 shrink-0 items-center gap-3 border-b border-[#02C39A]/35 bg-[#F5EFE1] px-4 sm:px-6">
        <span className="inline-flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[10px] bg-[#02C39A]/15">
          <Sun className="h-5 w-5 text-[#028090]" fill="currentColor" />
        </span>
        <h1
          className="text-[#14241D]"
          style={{
            fontFamily: 'var(--font-newsreader), Newsreader, Georgia, serif',
            fontSize: '22px',
            fontWeight: 600,
          }}
        >
          Tarhunna
        </h1>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 sm:py-8">
        <div className="mx-auto flex max-w-[720px] flex-col gap-6">
          <LandscapingEmptyState locale={locale} ownerName={ownerName} />

          <div className="grid grid-cols-2 gap-3">
            {quickLinks.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-4 shadow-sm transition-colors hover:border-[#02C39A]/50 hover:bg-[#02C39A]/5"
              >
                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#02C39A]/12 text-[#028090]">
                  <Icon className="h-5 w-5" />
                </span>
                <span className="text-[15px] font-semibold text-[#14241D]">{label}</span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

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
function MedspaDashboard() {
  const searchParams = useSearchParams()
  const heroVariant = searchParams.get('hero') === 'waiting' ? 'waiting' : 'brief'

  const [data, setData] = useState<MorningResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // M3 phone-number onboarding banner. We fetch the org's call-agent
  // status (which exposes vapi_phone_number_id) once on mount; the
  // banner is owner-only on the API side, so non-owner roles will see
  // a 403 and the predicate falls back to "no banner" — exactly what
  // we want. Failures are silent: the dashboard must keep rendering.
  const [showPhoneBanner, setShowPhoneBanner] = useState(false)
  useEffect(() => {
    let cancelled = false
    fetch('/api/org/call-agent', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (cancelled || !body) return
        setShowPhoneBanner(body.vapi_phone_number_id == null)
      })
      .catch(() => { /* silent — banner just won't render */ })
    return () => { cancelled = true }
  }, [])

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
      <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-[#02C39A]/35 bg-[#F5EFE1] px-4 sm:px-6">
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
          {/* M3 — finish-setup nudge. Renders only when the owner's
              org has vapi_phone_number_id IS NULL. Hidden for staff
              and for owners who've already provisioned. */}
          <PhoneNumberBanner shouldShow={showPhoneBanner} />
          {/* Tier-aware activation guide. Self-fetches its own status and
              renders only while setup is incomplete, independent of the
              morning-briefing load below. */}
          <SetupGuide />
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
              <div className="rise" style={{ '--stagger': 0 } as React.CSSProperties}>
                {heroVariant === 'waiting' ? (
                  <WaitingHero waiting={data.waiting} generatedAt={data.generatedAt} />
                ) : (
                  <BriefHero brief={data.brief} generatedAt={data.generatedAt} />
                )}
              </div>

              {/* ② Two-column grid: action stack | up-next + nudge */}
              <div className="rise grid gap-6 lg:grid-cols-[1.72fr_1fr]" style={{ '--stagger': 1 } as React.CSSProperties}>
                <ActionStack actions={data.actions} />
                <div className="flex flex-col gap-4">
                  <UpNextCard upNext={data.upNext} />
                  <NudgeCard nudge={data.nudge} />
                </div>
              </div>

              {/* ②a AI Twin metrics — lazy-loaded; only fetches once
                  the tile nears the viewport. */}
              <div className="rise" style={{ '--stagger': 2 } as React.CSSProperties}><AiTwinTile /></div>

              {/* ③ Schedule rail */}
              <div className="rise" style={{ '--stagger': 3 } as React.CSSProperties}><ScheduleRail schedule={data.schedule} dateLabel={dateLabel} /></div>

              {/* ④ Week strip */}
              <div className="rise" style={{ '--stagger': 4 } as React.CSSProperties}><WeekStrip week={data.week} /></div>

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
