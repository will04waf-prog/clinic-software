'use client'

/**
 * Phase 4 W6 — wrapper for the calendar grid.
 *
 * Owns:
 *   - Prev / today / next week navigation
 *   - Week-of header label (e.g. "Jun 24 – Jun 30, 2026")
 *   - Provider filter chips (toggle per-provider lanes)
 *   - Responsive day-count: 1 column under md (mobile force-day),
 *     7 columns on md+
 *   - The /api/booking/providers fetch (chips need the roster)
 *
 * Does NOT own:
 *   - The consultations data — passed in from the page so List and
 *     Calendar share a single source of truth.
 *   - The detail Sheet — separately mounted in the page, driven by
 *     ?selected URL param the grid sets via onSelect.
 */

import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Users } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CalendarGrid } from './calendar-grid'
import { CalendarSkeleton } from './calendar-skeleton'
import { weekDayKeysContaining, shiftDayKey, dayKeyInTz } from '@/lib/calendar/groupByDay'
import type { Consultation } from '@/types'

interface Provider {
  id: string
  display_name: string
  is_active: boolean
}

export interface CalendarViewProps {
  consultations: Consultation[]
  loading: boolean
  /** IANA clinic timezone — required for DST-safe bucketing. */
  timezone: string
  /** YYYY-MM-DD anchor date (clinic-local). View shows the week containing this. */
  date: string
  onDateChange: (newDate: string) => void
  /** Provider ids selected; empty array = "all providers". */
  selectedProviderIds: string[]
  onProviderFilterChange: (ids: string[]) => void
  selectedConsultationId: string | null
  onSelectConsultation: (id: string | null) => void
  /**
   * The ISO range the page fetched. Used to show a "no data loaded
   * for this range" banner if the user pages past the window with
   * prev/next so the empty grid doesn't look like "no consults" when
   * it's actually "no data fetched."
   */
  fetchWindow?: { fromIso: string; toIso: string }
}

// Tailwind breakpoint hook — true when viewport is >=768px (md).
// The initial state is computed lazily from window.matchMedia so SSR
// is safe (typeof window === 'undefined' → false) but client-side
// first paint already knows the right answer. Without this lazy init,
// every desktop owner sees a single-frame mobile layout flash before
// the useEffect runs.
function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia('(min-width: 768px)').matches
  })
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)')
    const handler = () => setDesktop(mq.matches)
    handler()
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  return desktop
}

export function CalendarView({
  consultations,
  loading,
  timezone,
  date,
  onDateChange,
  selectedProviderIds,
  onProviderFilterChange,
  selectedConsultationId,
  onSelectConsultation,
  fetchWindow,
}: CalendarViewProps) {
  const desktop = useIsDesktop()
  const dayKeys = useMemo(() => {
    // Mobile = single day. Desktop = 7-day week containing the date.
    if (!desktop) return [date]
    // Pass a noon-UTC instant for the date key so the week-containment
    // math is timezone-resilient.
    const [y, m, d] = date.split('-').map(Number)
    const noonUtc = new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
    return weekDayKeysContaining(noonUtc, timezone)
  }, [desktop, date, timezone])

  // ── Provider roster fetch ──
  const [providers, setProviders] = useState<Provider[]>([])
  useEffect(() => {
    let cancelled = false
    fetch('/api/booking/providers', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then(json => {
        if (cancelled) return
        const list = Array.isArray(json) ? json : (json.providers ?? [])
        setProviders(list.filter((p: Provider) => p.is_active))
      })
      .catch(() => { /* non-fatal — chips just won't render */ })
    return () => { cancelled = true }
  }, [])

  // ── Filter consultations by selected providers ──
  const filtered = useMemo(() => {
    if (selectedProviderIds.length === 0) return consultations
    const set = new Set(selectedProviderIds)
    // Special id 'unassigned' selects rows with no provider_id.
    const includeUnassigned = set.has('unassigned')
    return consultations.filter(c => {
      if (!c.provider_id) return includeUnassigned
      return set.has(c.provider_id)
    })
  }, [consultations, selectedProviderIds])

  // ── Range label for the header ──
  const rangeLabel = useMemo(() => {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      month: 'short',
      day:   'numeric',
    })
    const yearFmt = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric' })
    const noonUtcOf = (k: string) => {
      const [y, m, d] = k.split('-').map(Number)
      return new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
    }
    if (dayKeys.length === 1) {
      const dt = noonUtcOf(dayKeys[0])
      return `${new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'long', month: 'long', day: 'numeric' }).format(dt)}, ${yearFmt.format(dt)}`
    }
    const first = noonUtcOf(dayKeys[0])
    const last  = noonUtcOf(dayKeys[dayKeys.length - 1])
    return `${fmt.format(first)} – ${fmt.format(last)}, ${yearFmt.format(last)}`
  }, [dayKeys, timezone])

  // ── Nav handlers ──
  function shift(deltaDays: number) {
    onDateChange(shiftDayKey(date, deltaDays, timezone))
  }
  function goToday() {
    onDateChange(dayKeyInTz(new Date(), timezone))
  }

  function toggleProvider(id: string) {
    const has = selectedProviderIds.includes(id)
    onProviderFilterChange(has ? selectedProviderIds.filter(p => p !== id) : [...selectedProviderIds, id])
  }
  function clearProviderFilter() {
    onProviderFilterChange([])
  }

  return (
    <div className="space-y-3">
      {/* ── Nav row ── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => shift(desktop ? -7 : -1)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#0B2027]/15 bg-white text-[#14241D] hover:bg-[#FAF6EC]"
            aria-label={desktop ? 'Previous week' : 'Previous day'}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={goToday}
            className="rounded-md border border-[#0B2027]/15 bg-white px-3 py-1.5 text-[12.5px] font-semibold text-[#14241D] hover:bg-[#FAF6EC]"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => shift(desktop ? 7 : 1)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#0B2027]/15 bg-white text-[#14241D] hover:bg-[#FAF6EC]"
            aria-label={desktop ? 'Next week' : 'Next day'}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <p className="ml-1 text-[14px] font-semibold text-[#14241D]">{rangeLabel}</p>
        </div>
      </div>

      {/* ── Provider filter chips ── */}
      {providers.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Users className="h-3.5 w-3.5 text-[#4A5A60]" />
          <button
            type="button"
            onClick={clearProviderFilter}
            className={cn(
              'rounded-full border px-2.5 py-1 text-[11.5px] font-medium',
              selectedProviderIds.length === 0
                ? 'border-[#02C39A] bg-[#02C39A]/15 text-[#04B08C]'
                : 'border-[#0B2027]/15 bg-white text-[#4A5A60] hover:bg-[#FAF6EC]',
            )}
          >
            All
          </button>
          {providers.map(p => {
            const active = selectedProviderIds.includes(p.id)
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => toggleProvider(p.id)}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-[11.5px] font-medium',
                  active
                    ? 'border-[#02C39A] bg-[#02C39A]/15 text-[#04B08C]'
                    : 'border-[#0B2027]/15 bg-white text-[#4A5A60] hover:bg-[#FAF6EC]',
                )}
              >
                {p.display_name}
              </button>
            )
          })}
          <button
            type="button"
            onClick={() => toggleProvider('unassigned')}
            className={cn(
              'rounded-full border px-2.5 py-1 text-[11.5px] font-medium',
              selectedProviderIds.includes('unassigned')
                ? 'border-amber-500 bg-amber-50 text-amber-800'
                : 'border-[#0B2027]/15 bg-white text-[#4A5A60] hover:bg-[#FAF6EC]',
            )}
          >
            Unassigned
          </button>
        </div>
      )}

      {/* ── Out-of-window banner ── */}
      {fetchWindow && dayKeys.length > 0 && (() => {
        // Build noon-UTC instants for the first/last displayed days,
        // compare to the fetch window endpoints. Banner only shows
        // when the visible range pokes outside the loaded data.
        const noonUtcOf = (k: string) => {
          const [y, m, d] = k.split('-').map(Number)
          return Date.UTC(y, m - 1, d, 12, 0, 0)
        }
        const firstMs = noonUtcOf(dayKeys[0])
        const lastMs  = noonUtcOf(dayKeys[dayKeys.length - 1])
        const fromMs  = new Date(fetchWindow.fromIso).getTime()
        const toMs    = new Date(fetchWindow.toIso).getTime()
        if (firstMs < fromMs || lastMs > toMs) {
          return (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
              You're looking outside the loaded range. Refresh or jump to today to load this week's data.
            </div>
          )
        }
        return null
      })()}

      {/* ── The grid (or skeleton) ── */}
      {loading ? (
        <CalendarSkeleton dayCount={dayKeys.length} />
      ) : (
        <CalendarGrid
          consultations={filtered}
          dayKeys={dayKeys}
          timezone={timezone}
          selectedId={selectedConsultationId}
          onSelect={onSelectConsultation}
        />
      )}
    </div>
  )
}
