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
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { cn } from '@/lib/utils'
import { CalendarGrid } from './calendar-grid'
import { CalendarSkeleton } from './calendar-skeleton'
import { weekDayKeysContaining, shiftDayKey, dayKeyInTz } from '@/lib/calendar/groupByDay'
import { openHoursForDay, type AvailabilityRule, type AvailabilityOverride, type MinuteInterval } from '@/lib/calendar/openHoursForDay'
import { localToUtc } from '@/lib/booking/time-utils'
import { Button } from '@/components/ui/button'
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
  /**
   * W7: bubble up a reschedule mutation so the page can refresh
   * after the new scheduled_at is committed.
   */
  onMutated?: () => void
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
  onMutated,
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

  // ── Provider roster + availability rules + overrides fetch ──
  // All three drive the calendar context (filter chips, open-hours
  // shading). Fetched once per mount; the calendar doesn't refetch
  // on date change because rules/overrides are small (<<1KB for a
  // typical clinic) and don't change often.
  const [providers, setProviders] = useState<Provider[]>([])
  const [rules,     setRules]     = useState<AvailabilityRule[]>([])
  const [overrides, setOverrides] = useState<AvailabilityOverride[]>([])
  useEffect(() => {
    let cancelled = false
    const safeFetch = (url: string) =>
      fetch(url, { cache: 'no-store' })
        .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
        .catch(() => null)
    Promise.all([
      safeFetch('/api/booking/providers'),
      safeFetch('/api/booking/availability-rules'),
      safeFetch('/api/booking/availability-overrides'),
    ]).then(([provs, rulesRes, ovsRes]) => {
      if (cancelled) return
      if (provs) {
        const list = Array.isArray(provs) ? provs : (provs.providers ?? [])
        setProviders(list.filter((p: Provider) => p.is_active))
      }
      if (Array.isArray(rulesRes)) setRules(rulesRes)
      if (Array.isArray(ovsRes))   setOverrides(ovsRes)
    })
    return () => { cancelled = true }
  }, [])

  // ── Open-hours per visible day ──
  // Pre-computed once per dependency change so the grid receives a
  // ready-to-render map. Empty per-day intervals are fine — the
  // grid renders no shading for that day, which is honest about a
  // clinic-wide closure or unconfigured rules.
  // Honors the active provider filter so the shading matches the
  // tiles visible in the grid — when staff filter to "Dr. Smith"
  // only, the shading reflects Dr. Smith's hours, not the union.
  const openHoursByDay = useMemo(() => {
    if (providers.length === 0) return new Map<string, MinuteInterval[]>()
    // 'unassigned' is a sentinel chip that filters tile visibility
    // but maps to no real provider id — drop it before resolving
    // open hours so an unassigned-only filter shades nothing
    // (correct: provider_id NULL has no hours).
    const filterReal = selectedProviderIds.filter(id => id !== 'unassigned')
    const providerIds = filterReal.length === 0
      ? providers.map(p => p.id)
      : filterReal
    const m = new Map<string, MinuteInterval[]>()
    for (const dk of dayKeys) {
      m.set(dk, openHoursForDay(dk, providerIds, rules, overrides))
    }
    return m
  }, [dayKeys, providers, selectedProviderIds, rules, overrides])

  // ── W7: reschedule via drag — modal state ──
  // The grid emits onReschedule when a tile is dropped on a day
  // column. We show a confirmation modal before firing the API
  // (the API has SMS + email side-effects; double-confirming the
  // mutation is worth the extra click).
  const [pendingMove, setPendingMove] = useState<{
    consultation: Consultation
    newScheduledAt: string
    oldScheduledAt: string
  } | null>(null)
  const [rescheduleSubmitting, setRescheduleSubmitting] = useState(false)
  const [rescheduleError, setRescheduleError] = useState<string | null>(null)
  // Standalone toast for cases where there's no pending move to attach
  // the error to (e.g. DST spring-forward gap blocks the drop before
  // the modal even opens). Auto-dismisses; can also be cleared manually.
  const [toast, setToast] = useState<string | null>(null)

  function handleDropReschedule(consultationId: string, dayKey: string, minuteOfDay: number) {
    const c = consultations.find(x => x.id === consultationId)
    if (!c) return
    const [y, m, d] = dayKey.split('-').map(Number)
    const newUtc = localToUtc({ year: y, month: m, day: d }, minuteOfDay, timezone)
    if (!newUtc) {
      // DST spring-forward gap — picked an instant that doesn't
      // exist in clinic time. The modal isn't open (no pendingMove)
      // so surface the error via the top-level toast banner instead;
      // otherwise this branch would set hidden error state and the
      // owner would think the drop did nothing.
      setToast('That time doesn\'t exist on this day (DST gap). Try a slightly different slot.')
      window.setTimeout(() => setToast(null), 4500)
      return
    }
    // If the drop is to the same minute, skip the modal — no-op.
    if (Math.abs(newUtc.getTime() - new Date(c.scheduled_at).getTime()) < 60_000) return
    setPendingMove({
      consultation: c,
      newScheduledAt: newUtc.toISOString(),
      oldScheduledAt: c.scheduled_at,
    })
    setRescheduleError(null)
  }

  async function confirmReschedule() {
    if (!pendingMove) return
    setRescheduleSubmitting(true)
    setRescheduleError(null)
    try {
      // We don't have a manage token here (those are signed for
      // patients on /manage/[token]). Owner-side reschedule should
      // be handled via the dashboard's authenticated PATCH
      // endpoint, NOT the public /api/booking/reschedule which
      // requires a manage_token. Use the authenticated PATCH on
      // the consultation row.
      const res = await fetch(`/api/consultations/${pendingMove.consultation.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduled_at: pendingMove.newScheduledAt }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        // 409 from EXCLUDE constraint = slot taken.
        if (res.status === 409) throw new Error('That slot was just taken. Please pick another time.')
        throw new Error(j.error || j.message || `HTTP ${res.status}`)
      }
      setPendingMove(null)
      onMutated?.()
    } catch (err: any) {
      setRescheduleError(err?.message || 'Could not move the appointment.')
    } finally {
      setRescheduleSubmitting(false)
    }
  }

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

      {/* ── First-run hint: no availability rules configured yet ── */}
      {!loading && providers.length > 0 && rules.length === 0 && (
        <div className="rounded-md border border-[#0B2027]/15 bg-[#FAF6EC] px-3 py-2 text-[12px] text-[#4A5A60]">
          No clinic hours set yet — the calendar can't shade open times until you{' '}
          <a href="/settings/booking" className="font-semibold text-[#04B08C] underline-offset-2 hover:underline">
            add availability rules
          </a>
          .
        </div>
      )}

      {/* ── Top-level toast (DST gap, unscoped errors) ── */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] text-amber-900"
        >
          {toast}
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
          openHoursByDay={openHoursByDay}
          onReschedule={handleDropReschedule}
        />
      )}

      {/* ── Reschedule confirmation modal ── */}
      <DialogPrimitive.Root
        open={pendingMove !== null}
        onOpenChange={(open) => {
          // Don't close mid-submit — the user could miss the result
          // of an in-flight reschedule and end up looking at stale UI.
          if (!open && !rescheduleSubmitting) {
            setPendingMove(null)
            setRescheduleError(null)
          }
        }}
      >
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/30 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
          <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-[#0B2027]/10 bg-white p-5 shadow-xl">
            <DialogPrimitive.Title className="text-[16px] font-semibold text-[#14241D]">Move appointment?</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">
              Confirm rescheduling the consultation to the new time.
            </DialogPrimitive.Description>
            {pendingMove && (
              <div className="mt-3 space-y-3 text-[13px] text-[#4A5A60]">
                <p>
                  Move{' '}
                  <strong className="text-[#14241D]">
                    {[pendingMove.consultation.contact?.first_name, pendingMove.consultation.contact?.last_name].filter(Boolean).join(' ') || 'this patient'}
                  </strong>
                  {' '}from{' '}
                  <strong className="text-[#14241D]">
                    {new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(pendingMove.oldScheduledAt))}
                  </strong>
                  {' '}to{' '}
                  <strong className="text-[#14241D]">
                    {new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(pendingMove.newScheduledAt))}
                  </strong>
                  ?
                </p>
                <p className="text-[12px] text-[#7E8C90]">
                  The patient won't be notified automatically — text or call them after if needed.
                </p>
                {rescheduleError && (
                  <p className="rounded-md border border-red-200 bg-red-50 px-2.5 py-2 text-[12px] text-red-700">{rescheduleError}</p>
                )}
                <div className="flex justify-end gap-2 pt-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { setPendingMove(null); setRescheduleError(null) }}
                    disabled={rescheduleSubmitting}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={confirmReschedule}
                    disabled={rescheduleSubmitting}
                  >
                    {rescheduleSubmitting ? 'Moving…' : 'Move appointment'}
                  </Button>
                </div>
              </div>
            )}
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </div>
  )
}
