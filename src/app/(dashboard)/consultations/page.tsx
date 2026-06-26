'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { CalendarDays, List } from 'lucide-react'
import { Header } from '@/components/layout/header'
import { ConsultationList } from '@/components/consultations/consultation-list'
import { CalendarView } from '@/components/consultations/calendar-view'
import { ConsultationDetailSheet } from '@/components/consultations/consultation-detail-sheet'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { dayKeyInTz } from '@/lib/calendar/groupByDay'
import type { Consultation } from '@/types'

function ConsultationsSkeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-start gap-4 rounded-xl border border-gray-200 bg-white p-4">
          <div className="h-16 w-[60px] shrink-0 rounded-lg bg-gray-200" />
          <div className="flex-1 space-y-2 pt-1">
            <div className="h-4 w-40 rounded bg-gray-200" />
            <div className="h-3 w-24 rounded bg-gray-100" />
            <div className="h-3 w-32 rounded bg-gray-100" />
          </div>
          <div className="h-8 w-8 shrink-0 rounded bg-gray-100" />
        </div>
      ))}
    </div>
  )
}

export default function ConsultationsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()

  // ── URL-backed state ──
  // view = 'list' | 'calendar' (default 'list' to preserve unchanged behavior)
  // date = YYYY-MM-DD anchor for the calendar (default = today in browser tz;
  //   replaced with clinic-tz today once the org timezone arrives below)
  // providers = comma-separated provider ids (filter chips) — '' means all
  // selected = consultation id for the detail sheet
  const view      = searchParams.get('view') === 'calendar' ? 'calendar' : 'list'
  const dateParam = searchParams.get('date')
  const providersParam = searchParams.get('providers') ?? ''
  const selectedId = searchParams.get('selected') ?? null
  const selectedProviderIds = providersParam ? providersParam.split(',').filter(Boolean) : []

  const setParam = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(searchParams.toString())
      if (value === null || value === '') next.delete(key)
      else next.set(key, value)
      router.replace(`?${next.toString()}`, { scroll: false })
    },
    [router, searchParams],
  )

  // ── Data ──
  const [consultations, setConsultations] = useState<Consultation[]>([])
  const [timezone,      setTimezone]      = useState<string>('America/New_York')
  const [loading,       setLoading]       = useState(true)
  const [error,         setError]         = useState<string | null>(null)
  const [tab,           setTab]           = useState('upcoming') // list-mode sub-tab
  const [fetchWindow, setFetchWindow] = useState<{ fromIso: string; toIso: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // List view wants the last 90 days; calendar view wants a
      // narrow week window. We fetch a generous range that covers
      // both — start of last 90 days through end of next 60 — so a
      // single fetch powers both view modes without re-querying on
      // toggle. Owners with thousands of consultations should be
      // moved onto the windowed calendar query in W7.
      const fromIso = new Date(Date.now() - 90 * 86_400_000).toISOString()
      const toIso   = new Date(Date.now() + 60 * 86_400_000).toISOString()
      setFetchWindow({ fromIso, toIso })
      const url  = `/api/consultations?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}&include=organization`
      const res  = await fetch(url, { cache: 'no-store' })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || `HTTP ${res.status}`)
      }
      const json = await res.json()
      // /api/consultations returns either bare array (legacy) or
      // { consultations, organization } when include=organization.
      if (Array.isArray(json)) {
        setConsultations(json)
      } else {
        setConsultations(json.consultations ?? [])
        if (json.organization?.timezone) setTimezone(json.organization.timezone)
      }
    } catch (err: any) {
      setError(err.message ?? 'Failed to load consultations')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Clear orphan ?selected if the row isn't in the loaded data
  // (deleted, archived, or stale link). Runs after every load.
  useEffect(() => {
    if (loading) return
    if (!selectedId) return
    if (!consultations.some(c => c.id === selectedId)) {
      setParam('selected', null)
    }
  }, [loading, selectedId, consultations, setParam])

  // Once the clinic timezone is known, if ?date wasn't set, anchor it
  // to today-in-clinic-time so the calendar opens on the right week
  // regardless of the owner's browser timezone.
  const calendarDate = useMemo(() => {
    if (dateParam) return dateParam
    return dayKeyInTz(new Date(), timezone)
  }, [dateParam, timezone])

  // ── List-mode buckets ──
  const now = new Date()
  const todayStr = now.toDateString()

  const upcoming = consultations.filter(
    (c) =>
      new Date(c.scheduled_at) >= now &&
      (c.status === 'scheduled' || c.status === 'confirmed'),
  )
  const today = consultations.filter(
    (c) => new Date(c.scheduled_at).toDateString() === todayStr,
  )
  const noShows = consultations.filter((c) => c.status === 'no_show')
  const completed = consultations.filter((c) => c.status === 'completed')

  function getList(): Consultation[] {
    switch (tab) {
      case 'today':     return today
      case 'no_shows':  return noShows
      case 'completed': return completed
      default:          return upcoming
    }
  }

  // ── Sheet wiring ──
  const selectedConsult = useMemo(
    () => (selectedId ? consultations.find(c => c.id === selectedId) ?? null : null),
    [consultations, selectedId],
  )
  function selectConsultation(id: string | null) {
    setParam('selected', id)
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header
        title="Consultations"
        subtitle={`${upcoming.length} upcoming · ${today.length} today`}
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {/* ── List/Calendar toggle ── */}
        <div className="flex items-center gap-1 rounded-lg border border-[#0B2027]/10 bg-white p-0.5 w-fit">
          <button
            type="button"
            onClick={() => setParam('view', null)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-semibold transition',
              view === 'list'
                ? 'bg-[#02C39A]/15 text-[#04B08C]'
                : 'text-[#4A5A60] hover:bg-[#FAF6EC]',
            )}
          >
            <List className="h-3.5 w-3.5" />
            List
          </button>
          <button
            type="button"
            onClick={() => setParam('view', 'calendar')}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-semibold transition',
              view === 'calendar'
                ? 'bg-[#02C39A]/15 text-[#04B08C]'
                : 'text-[#4A5A60] hover:bg-[#FAF6EC]',
            )}
          >
            <CalendarDays className="h-3.5 w-3.5" />
            Calendar
          </button>
        </div>

        {/* ── List sub-tabs (only in list mode) ── */}
        {view === 'list' && (
          <div className="overflow-x-auto">
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList>
                <TabsTrigger value="upcoming">Upcoming ({upcoming.length})</TabsTrigger>
                <TabsTrigger value="today">Today ({today.length})</TabsTrigger>
                <TabsTrigger value="no_shows">No-Shows ({noShows.length})</TabsTrigger>
                <TabsTrigger value="completed">Completed ({completed.length})</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        )}

        {/* ── Body ── */}
        <div>
          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
              <p className="text-sm font-medium text-red-700">Failed to load consultations</p>
              <p className="text-xs text-red-500 mt-0.5">{error}</p>
              <button onClick={load} className="mt-2 text-xs text-red-600 underline">Retry</button>
            </div>
          ) : view === 'calendar' ? (
            <CalendarView
              consultations={consultations}
              loading={loading}
              timezone={timezone}
              date={calendarDate}
              onDateChange={(d) => setParam('date', d)}
              selectedProviderIds={selectedProviderIds}
              onProviderFilterChange={(ids) =>
                setParam('providers', ids.length === 0 ? null : ids.join(','))
              }
              selectedConsultationId={selectedId}
              onSelectConsultation={selectConsultation}
              fetchWindow={fetchWindow ?? undefined}
            />
          ) : loading ? (
            <ConsultationsSkeleton />
          ) : (
            <ConsultationList consultations={getList()} onRefresh={load} />
          )}
        </div>
      </div>

      <ConsultationDetailSheet
        consultation={selectedConsult}
        timezone={timezone}
        open={selectedConsult !== null}
        onOpenChange={(open) => { if (!open) selectConsultation(null) }}
        onMutated={load}
      />
    </div>
  )
}
