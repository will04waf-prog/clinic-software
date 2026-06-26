'use client'

/**
 * Phase 4 W6 — week/day calendar grid for /consultations.
 *
 * Hour rows on the Y axis (DAY_START_HOUR..DAY_END_HOUR). Day columns
 * on the X axis (7 columns on md+, 1 column on mobile). Consultation
 * tiles are absolutely positioned inside their day column.
 *
 * DST-safe contracts:
 *   - Day bucketing: Intl.DateTimeFormat({ timeZone }) via groupByDay
 *     helpers. Never `new Date(localString)` math.
 *   - Tile START y-position: minutes-since-clinic-midnight from Intl.
 *   - Tile HEIGHT: REAL elapsed milliseconds between scheduled_at and
 *     end_at. Using `minutesSinceMidnightInTz(end) - minutesSinceMidnightInTz(start)`
 *     would silently mis-size tiles that straddle a DST transition
 *     (the wall clock jumps; the elapsed time does not).
 *
 * Lanes: layoutLanes() produces per-cluster widths so a 3-way 9am
 * overlap doesn't shrink an isolated 3pm tile to 1/3 column width.
 *
 * Status visual encoding:
 *   - hold        → amber diagonal stripe on amber-50 base
 *   - scheduled   → mint fill
 *   - confirmed   → mint fill, slightly darker
 *   - completed   → gray fill
 *   - no_show     → red fill, struck through
 *   - canceled    → small marker to the side of the column (does not
 *                   compete for lane width); aria-labeled for SR
 *
 * Off-grid tiles (before DAY_START_HOUR / after DAY_END_HOUR) are
 * not rendered as full tiles — they're surfaced as small badges
 * at the top/bottom of the column ("+2 before 7am", "+1 after 9pm").
 */

import { useEffect, useMemo, useState } from 'react'
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { cn } from '@/lib/utils'
import {
  bucketByClinicDay,
  minutesSinceMidnightInTz,
  dayKeyInTz,
} from '@/lib/calendar/groupByDay'
import { layoutLanes, type LaneItem } from '@/lib/calendar/layoutLanes'
import type { MinuteInterval } from '@/lib/calendar/openHoursForDay'
import type { Consultation } from '@/types'

export const DAY_START_HOUR = 7   // 7am
export const DAY_END_HOUR   = 21  // 9pm
const TOTAL_MINUTES = (DAY_END_HOUR - DAY_START_HOUR) * 60

export interface CalendarGridProps {
  consultations: Consultation[]
  /** YYYY-MM-DD day keys (clinic-local), in order. 1 = Day view, 7 = Week view. */
  dayKeys: string[]
  /** IANA clinic timezone, e.g. 'America/New_York'. */
  timezone: string
  /** Optional id of the consultation currently selected (highlighted). */
  selectedId?: string | null
  onSelect?: (consultationId: string) => void
  /**
   * W7: clinic-local "open hours" intervals per day key. Rendered as
   * faint background shading behind the hour grid so the owner can
   * visually orient. Days missing from the map render with no
   * shading (treated as closed for shading purposes — honest about
   * unconfigured rules).
   */
  openHoursByDay?: Map<string, MinuteInterval[]>
  /**
   * W7: drag-to-reschedule. Fires when a draggable tile is released
   * over a day column. The handler is expected to show a
   * confirmation modal before calling the reschedule API; we don't
   * mutate optimistically here because the user might dismiss.
   *
   * dayKey is YYYY-MM-DD clinic-local. minuteOfDay is the drop
   * position snapped to 15-min increments, clamped to the visible
   * 7am-9pm band.
   */
  onReschedule?: (consultationId: string, dayKey: string, minuteOfDay: number) => void
}

const SNAP_MINUTES = 15

// ── Tile colors keyed by status ──
function tileClassesForStatus(status: Consultation['status']): string {
  switch (status) {
    case 'hold':
      // Solid amber base under the stripe so anti-aliasing artifacts
      // don't show through to whatever's behind the grid.
      return 'bg-amber-50 border-amber-500/40 text-amber-900 [background-image:repeating-linear-gradient(45deg,rgba(181,113,15,0.18)_0_6px,rgba(181,113,15,0.06)_6px_12px)]'
    case 'confirmed':
      return 'bg-[#02C39A]/22 border-[#02C39A]/55 text-[#14241D]'
    case 'scheduled':
      return 'bg-[#02C39A]/13 border-[#02C39A]/40 text-[#14241D]'
    case 'completed':
      return 'bg-gray-200/70 border-gray-300 text-gray-700'
    case 'no_show':
      return 'bg-red-100 border-red-300 text-red-700 line-through decoration-red-400'
    default:
      return 'bg-[#02C39A]/13 border-[#02C39A]/40 text-[#14241D]'
  }
}

const STATUS_LABEL_FOR_SR: Record<string, string> = {
  hold:        'On hold',
  scheduled:   'Scheduled',
  confirmed:   'Confirmed',
  completed:   'Completed',
  no_show:     'No-show',
  canceled:    'Canceled',
  rescheduled: 'Rescheduled',
}

// End-time derivation (memoized via callers, not here).
function endIsoFor(c: Consultation): string {
  if (c.end_at) return c.end_at
  return new Date(new Date(c.scheduled_at).getTime() + (c.duration_min ?? 30) * 60_000).toISOString()
}

/** Real elapsed minutes between start and end — NOT wall-clock minutes. */
function elapsedMinutes(c: Consultation, endIso: string): number {
  return (new Date(endIso).getTime() - new Date(c.scheduled_at).getTime()) / 60_000
}

interface TileItem extends LaneItem {
  consultation: Consultation
  endIso: string
}

/** A live-updating minutes-since-clinic-midnight value (re-renders every 60s). */
function useNowMinutes(timezone: string): { minutes: number; dayKey: string } {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setTick(t => t + 1), 60_000)
    return () => window.clearInterval(id)
  }, [])
  // tick is intentionally read so the IDE / linter sees the dependency.
  void tick
  const now = new Date()
  return {
    minutes: minutesSinceMidnightInTz(now, timezone),
    dayKey:  dayKeyInTz(now, timezone),
  }
}

// Drag eligibility — only active, future, owner-actionable rows.
function isDraggable(c: Consultation): boolean {
  if (c.status !== 'scheduled' && c.status !== 'confirmed') return false
  return new Date(c.scheduled_at).getTime() > Date.now()
}

export function CalendarGrid({
  consultations,
  dayKeys,
  timezone,
  selectedId,
  onSelect,
  openHoursByDay,
  onReschedule,
}: CalendarGridProps) {
  // Pointer sensor — drag won't trigger until 6px of movement, so a
  // bare click on a tile still opens the detail sheet.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  )

  function handleDragEnd(event: DragEndEvent) {
    if (!onReschedule) return
    const { active, over, delta, activatorEvent } = event
    if (!over) return
    // over.id encodes the target day key as `day:YYYY-MM-DD`.
    const overId = String(over.id)
    if (!overId.startsWith('day:')) return
    const dayKey = overId.slice(4)
    // Use VIEWPORT (clientY) coords, not page coords. over.rect.top
    // returned by @dnd-kit is in viewport coords; mixing with pageY
    // would silently break by window.scrollY pixels on any scrolled
    // page. delta.y is itself a viewport delta.
    const activator = activatorEvent as { clientY?: number } | undefined
    const clientY = activator?.clientY
    if (typeof clientY !== 'number') return
    const dropClientY = clientY + delta.y
    const rect = over.rect
    const relY = dropClientY - rect.top
    const ratio = Math.max(0, Math.min(1, relY / rect.height))
    const rawMin = ratio * (DAY_END_HOUR - DAY_START_HOUR) * 60
    const snapped = Math.round(rawMin / SNAP_MINUTES) * SNAP_MINUTES
    const absoluteMinute = DAY_START_HOUR * 60 + snapped
    onReschedule(String(active.id), dayKey, absoluteMinute)
  }
  // ── Split rows up-front. Canceled/rescheduled don't compete for
  // lane space; they render as a small side indicator. ──
  const { active, canceled } = useMemo(() => {
    const a: Consultation[] = []
    const c: Consultation[] = []
    for (const item of consultations) {
      if (item.status === 'canceled' || item.status === 'rescheduled') c.push(item)
      else a.push(item)
    }
    return { active: a, canceled: c }
  }, [consultations])

  const activeByDay   = useMemo(() => bucketByClinicDay(active,   timezone, c => c.scheduled_at), [active, timezone])
  const canceledByDay = useMemo(() => bucketByClinicDay(canceled, timezone, c => c.scheduled_at), [canceled, timezone])

  const activeLookup = useMemo(() => {
    const m = new Map<string, Consultation[]>()
    for (const { day, items } of activeByDay) m.set(day, items)
    return m
  }, [activeByDay])
  const canceledLookup = useMemo(() => {
    const m = new Map<string, Consultation[]>()
    for (const { day, items } of canceledByDay) m.set(day, items)
    return m
  }, [canceledByDay])

  // Hour labels rendered down the left rail.
  const hourLabels: Array<{ hour: number; label: string }> = []
  for (let h = DAY_START_HOUR; h < DAY_END_HOUR; h++) {
    const ampm = h < 12 ? 'AM' : 'PM'
    const display = h === 0 ? 12 : h > 12 ? h - 12 : h
    hourLabels.push({ hour: h, label: `${display} ${ampm}` })
  }

  const dayHeaderFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    month:   'short',
    day:     'numeric',
  })
  const tileTimeFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour:     'numeric',
    minute:   '2-digit',
    hour12:   true,
  })

  // ── Live "now" indicator. Ticks every 60s; freezes when component unmounts. ──
  const { minutes: nowMinutes, dayKey: todayKey } = useNowMinutes(timezone)
  const todayColIdx = dayKeys.indexOf(todayKey)
  const showNowLine =
    todayColIdx >= 0 &&
    nowMinutes >= DAY_START_HOUR * 60 &&
    nowMinutes <= DAY_END_HOUR * 60
  const nowTopPct = ((nowMinutes - DAY_START_HOUR * 60) / TOTAL_MINUTES) * 100

  const gridTemplate = `60px repeat(${dayKeys.length}, minmax(0, 1fr))`

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
    <div className="rounded-xl border border-[#0B2027]/10 bg-white">
      {/* ── Header row ── */}
      <div
        className="grid border-b border-[#0B2027]/10"
        style={{ gridTemplateColumns: gridTemplate }}
      >
        <div aria-hidden="true" />
        {dayKeys.map(dk => {
          const [y, m, d] = dk.split('-').map(Number)
          const noonUtc = new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
          const isToday = dk === todayKey
          return (
            <div
              key={dk}
              className={cn(
                'px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wider',
                isToday ? 'text-[#04B08C]' : 'text-[#4A5A60]',
              )}
            >
              {dayHeaderFmt.format(noonUtc)}
            </div>
          )
        })}
      </div>

      {/* ── Body: hour rail + day columns ── */}
      <div
        className="relative grid"
        style={{
          gridTemplateColumns: gridTemplate,
          gridTemplateRows: `repeat(${DAY_END_HOUR - DAY_START_HOUR}, minmax(56px, 1fr))`,
        }}
      >
        {/* Hour labels (left rail) */}
        {hourLabels.map(({ hour, label }) => (
          <div
            key={`hr-${hour}`}
            aria-hidden="true"
            className="col-start-1 border-t border-[#0B2027]/5 px-1.5 pt-1 text-[10px] font-medium text-[#9CA3AF]"
            style={{ gridRow: hour - DAY_START_HOUR + 1 }}
          >
            {label}
          </div>
        ))}

        {dayKeys.map((dk, colIdx) => {
          const dayActive   = activeLookup.get(dk) ?? []
          const dayCanceled = canceledLookup.get(dk) ?? []

          // Pre-compute endIso + elapsed minutes for each active row so
          // (a) we don't recompute in two passes, (b) the lane layout
          // sees the exact same endpoints the render does.
          const enriched = dayActive.map(c => {
            const endIso = endIsoFor(c)
            return {
              c,
              endIso,
              startMin: minutesSinceMidnightInTz(c.scheduled_at, timezone),
              elapsed:  elapsedMinutes(c, endIso),
            }
          })

          // Count off-grid drops (before 7am / after 9pm) BEFORE the
          // layout pass — those tiles don't render visually but the
          // owner needs to know they exist.
          let beforeCount = 0
          let afterCount  = 0
          const inGrid: typeof enriched = []
          for (const e of enriched) {
            const startMin = e.startMin
            const endMin   = startMin + e.elapsed
            if (endMin <= DAY_START_HOUR * 60) { beforeCount++; continue }
            if (startMin >= DAY_END_HOUR * 60) { afterCount++; continue }
            inGrid.push(e)
          }

          const lanes = layoutLanes<TileItem>(
            inGrid.map(e => ({
              id:       e.c.id,
              startUtc: e.c.scheduled_at,
              endUtc:   e.endIso,
              consultation: e.c,
              endIso:   e.endIso,
            })),
          )

          return (
            <DayColumn key={`col-${dk}`} dayKey={dk} colIdx={colIdx}>
              {/* W7: Open-hours background fills — faint mint when the
                  clinic is open. Rendered BEFORE the hour grid lines
                  so the lines are still visible across the shading.
                  Clamped to the visible 7am-9pm band. */}
              {(openHoursByDay?.get(dk) ?? []).map((iv, i) => {
                const cs = Math.max(iv.startMin, DAY_START_HOUR * 60)
                const ce = Math.min(iv.endMin,   DAY_END_HOUR   * 60)
                if (ce <= cs) return null
                const top    = ((cs - DAY_START_HOUR * 60) / TOTAL_MINUTES) * 100
                const height = ((ce - cs) / TOTAL_MINUTES) * 100
                return (
                  <div
                    key={`open-${dk}-${i}`}
                    aria-hidden="true"
                    className="pointer-events-none absolute left-0 right-0 bg-[#02C39A]/[0.07]"
                    style={{ top: `${top}%`, height: `${height}%` }}
                  />
                )
              })}

              {/* Faint hour grid lines */}
              {hourLabels.map(({ hour }) => (
                <div
                  key={`grid-${dk}-${hour}`}
                  aria-hidden="true"
                  className="pointer-events-none absolute left-0 right-0 border-t border-[#0B2027]/5"
                  style={{ top: `${((hour - DAY_START_HOUR) * 60 / TOTAL_MINUTES) * 100}%` }}
                />
              ))}

              {/* Off-grid badges */}
              {beforeCount > 0 && (
                <div
                  className="absolute left-1 right-1 top-0 z-10 truncate rounded-b-md border border-t-0 border-[#0B2027]/15 bg-white px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#7E8C90]"
                  title={`${beforeCount} consult${beforeCount > 1 ? 's' : ''} before ${DAY_START_HOUR}am`}
                >
                  +{beforeCount} before {DAY_START_HOUR}am
                </div>
              )}
              {afterCount > 0 && (
                <div
                  className="absolute left-1 right-1 bottom-0 z-10 truncate rounded-t-md border border-b-0 border-[#0B2027]/15 bg-white px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#7E8C90]"
                  title={`${afterCount} consult${afterCount > 1 ? 's' : ''} after ${DAY_END_HOUR > 12 ? DAY_END_HOUR - 12 : DAY_END_HOUR}pm`}
                >
                  +{afterCount} after {DAY_END_HOUR > 12 ? DAY_END_HOUR - 12 : DAY_END_HOUR}pm
                </div>
              )}

              {/* Tiles */}
              {lanes.map(({ item, lane, totalLanes }) => {
                const c = item.consultation
                const startMin = minutesSinceMidnightInTz(c.scheduled_at, timezone)
                const elapsed  = elapsedMinutes(c, item.endIso)
                const endMinReal = startMin + elapsed
                const clampedStart = Math.max(startMin,   DAY_START_HOUR * 60)
                const clampedEnd   = Math.min(endMinReal, DAY_END_HOUR   * 60)
                if (clampedEnd <= clampedStart) return null
                const topPct    = ((clampedStart - DAY_START_HOUR * 60) / TOTAL_MINUTES) * 100
                const heightPct = ((clampedEnd - clampedStart) / TOTAL_MINUTES) * 100
                const widthPct  = 100 / totalLanes
                const leftPct   = lane * widthPct
                const isSelected = selectedId === c.id
                const tileClasses = tileClassesForStatus(c.status)
                const contactName = [c.contact?.first_name, c.contact?.last_name].filter(Boolean).join(' ') || 'Patient'
                const serviceName = c.service?.name || c.procedure_discussed?.[0] || c.type || 'Consult'
                const srLabel = `${STATUS_LABEL_FOR_SR[c.status] ?? 'Scheduled'}: ${contactName}, ${serviceName}, ${tileTimeFmt.format(new Date(c.scheduled_at))}`
                return (
                  <DraggableTile
                    key={c.id}
                    consultation={c}
                    topPct={topPct}
                    heightPct={heightPct}
                    leftPct={leftPct}
                    widthPct={widthPct}
                    tileClasses={cn(tileClasses, !c.provider_id && 'border-dashed')}
                    isSelected={isSelected}
                    srLabel={srLabel}
                    onClick={() => onSelect?.(c.id)}
                  >
                    <div className="truncate font-semibold">
                      {tileTimeFmt.format(new Date(c.scheduled_at))} · {contactName}
                    </div>
                    <div className="truncate text-[10px] opacity-80">
                      {serviceName}
                    </div>
                  </DraggableTile>
                )
              })}

              {/* Canceled / rescheduled rows — render as thin LEFT-EDGE
                  markers (gutter), so they don't fight regular tiles
                  for the right edge at 4+ lanes. */}
              {dayCanceled.map(c => {
                const endIso = endIsoFor(c)
                const startMin = minutesSinceMidnightInTz(c.scheduled_at, timezone)
                const endMinReal = startMin + elapsedMinutes(c, endIso)
                if (endMinReal <= DAY_START_HOUR * 60 || startMin >= DAY_END_HOUR * 60) return null
                const cs = Math.max(startMin,   DAY_START_HOUR * 60)
                const ce = Math.min(endMinReal, DAY_END_HOUR   * 60)
                const top = ((cs - DAY_START_HOUR * 60) / TOTAL_MINUTES) * 100
                const h   = ((ce - cs) / TOTAL_MINUTES) * 100
                const contactName = [c.contact?.first_name, c.contact?.last_name].filter(Boolean).join(' ') || 'Patient'
                const label = `${STATUS_LABEL_FOR_SR[c.status] ?? 'Canceled'}: ${contactName} at ${tileTimeFmt.format(new Date(c.scheduled_at))}`
                return (
                  <button
                    key={`x-${c.id}`}
                    type="button"
                    onClick={() => onSelect?.(c.id)}
                    aria-label={label}
                    className="absolute left-0 w-1 rounded-r-sm bg-gray-300 opacity-70 hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#04B08C]"
                    style={{ top: `${top}%`, height: `${Math.max(h, 2)}%` }}
                    title={label}
                  />
                )
              })}

              {/* "now" line — today's column only */}
              {showNowLine && colIdx === todayColIdx && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute left-0 right-0 z-10 flex items-center"
                  style={{ top: `${nowTopPct}%` }}
                >
                  <span className="-ml-1 inline-block h-2 w-2 rounded-full bg-[#04B08C]" />
                  <span className="ml-0 h-[2px] flex-1 bg-[#04B08C]" />
                </div>
              )}
            </DayColumn>
          )
        })}
      </div>
    </div>
    </DndContext>
  )
}

// ── Draggable tile sub-component ──
// useDraggable must be called inside a component — can't go inline
// in a .map(). DraggableTile owns the hook + the visual feedback
// (transform, opacity-while-dragging). When the consultation isn't
// drag-eligible (hold, completed, no_show, canceled, or in the past)
// the hook is `disabled`, listeners are no-ops, and the tile reverts
// to a plain click target.
function DraggableTile({
  consultation,
  topPct,
  heightPct,
  leftPct,
  widthPct,
  tileClasses,
  isSelected,
  srLabel,
  onClick,
  children,
}: {
  consultation: Consultation
  topPct: number
  heightPct: number
  leftPct: number
  widthPct: number
  tileClasses: string
  isSelected: boolean
  srLabel: string
  onClick: () => void
  children: React.ReactNode
}) {
  const disabled = !isDraggable(consultation)
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: consultation.id,
    disabled,
  })
  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onClick}
      aria-label={srLabel}
      className={cn(
        'absolute overflow-hidden rounded-md border px-1.5 py-1 text-left text-[11px] leading-tight shadow-sm transition hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#04B08C] focus-visible:outline-offset-[-2px]',
        tileClasses,
        isSelected && 'ring-2 ring-inset ring-[#04B08C]',
        isDragging ? 'z-50 opacity-60 cursor-grabbing' : 'hover:z-10',
        !disabled && !isDragging && 'cursor-grab',
      )}
      style={{
        top:    `${topPct}%`,
        height: `${Math.max(heightPct, 3)}%`,
        left:   `calc(${leftPct}% + 2px)`,
        width:  `calc(${widthPct}% - 4px)`,
        transform: transform
          ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
          : undefined,
      }}
      {...attributes}
      {...listeners}
    >
      {children}
    </button>
  )
}

// ── Droppable day column wrapper ──
// useDroppable similarly must be inside a component. DayColumn just
// adds the drop ref + a faint highlight while a drag is hovering.
function DayColumn({
  dayKey,
  colIdx,
  children,
}: {
  dayKey: string
  colIdx: number
  children: React.ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${dayKey}` })
  return (
    <div
      ref={setNodeRef}
      key={`col-${dayKey}`}
      className={cn(
        'relative col-span-1 border-l border-[#0B2027]/5',
        isOver && 'bg-[#02C39A]/[0.04] outline outline-2 -outline-offset-2 outline-[#02C39A]/40',
      )}
      style={{
        gridColumn: colIdx + 2,
        gridRow: `1 / ${DAY_END_HOUR - DAY_START_HOUR + 1}`,
      }}
    >
      {children}
    </div>
  )
}
