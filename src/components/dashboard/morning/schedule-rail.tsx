import Link from 'next/link'
import { ArrowRight, ArrowUpRight, NotepadText, Check, Link as LinkIcon, CalendarHeart } from 'lucide-react'
import { InitialAvatar } from './initial-avatar'
import { cn } from '@/lib/utils'
import type { ScheduleItem, ScheduleConsult } from './types'

/**
 * Today's horizontal schedule rail. Consult tiles + open-slot tiles
 * interleaved in time order. Tiles needing prep get a mint accent +
 * forest CTA. Open slots are dashed-border placeholders inviting the
 * user to share their booking link.
 */

const STATUS_PILL: Record<ScheduleConsult['status']['tone'], string> = {
  booked: 'bg-[#02C39A]/15 text-[#04B08C]',
  new:    'bg-[#14241D] text-[#FAF6EC]',
  follow: 'bg-[#B5710F]/13 text-[#9A5F0B]',
}

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  'arrow-up-right': ArrowUpRight,
  'note-pencil': NotepadText,
  check: Check,
}

interface Props {
  schedule: ScheduleItem[]
  dateLabel: string
}

export function ScheduleRail({ schedule, dateLabel }: Props) {
  const consultCount = schedule.filter(s => s.type === 'consult').length
  const hasAny = schedule.length > 0

  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-baseline gap-3">
        <h2 className="text-[17px] font-bold text-[#14241D]">Today</h2>
        <span className="text-[12.5px] text-[#7E8C90]">
          {dateLabel} · {consultCount} consult{consultCount === 1 ? '' : 's'}
        </span>
        <Link
          href="/consultations"
          className="ml-auto inline-flex items-center gap-1 text-[12.5px] font-semibold text-[#026B78] hover:text-[#028090]"
        >
          Open calendar
          <ArrowRight className="h-3 w-3" strokeWidth={2.4} />
        </Link>
      </header>

      <div className="rounded-2xl bg-white p-[16px] shadow-[0_1px_2px_rgba(11,32,39,0.05)]">
        <div className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-[#02C39A]/15 px-2.5 py-1 text-[11px] font-bold text-[#04B08C]">
          <span className="h-[7px] w-[7px] rounded-full bg-[#02C39A]" />
          Now · {new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
        </div>

        {!hasAny ? (
          <EmptySchedule />
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-1">
            {schedule.map((item, i) =>
              item.type === 'consult'
                ? <ConsultTile key={i} item={item} />
                : <OpenSlotTile key={i} range={item.range} label={item.label} note={item.note} />
            )}
          </div>
        )}
      </div>
    </section>
  )
}

function ConsultTile({ item }: { item: ScheduleConsult }) {
  const C = ICONS[item.cta.icon] ?? ArrowUpRight
  const prep = item.prep
  return (
    <div
      className={cn(
        'flex w-[234px] shrink-0 flex-col gap-2.5 rounded-[14px] p-3',
        prep
          ? 'bg-white shadow-[0_0_0_3px_rgba(2,195,154,0.18)] border border-[#02C39A]'
          : 'bg-[#FBF8F0] border border-[#ECE4D4]',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-baseline gap-1">
          <span
            className="text-[#14241D]"
            style={{
              fontFamily: 'var(--font-newsreader), Newsreader, Georgia, serif',
              fontSize: '23px',
              fontWeight: 600,
            }}
          >
            {item.hr}
          </span>
          <span className="text-[12px] font-bold text-[#7E8C90]">{item.mer}</span>
        </p>
        <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold', STATUS_PILL[item.status.tone])}>
          {item.status.label}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <InitialAvatar initials={item.initials} tint={item.tint} size="sm" />
        <div className="min-w-0">
          <p className="truncate text-[13.5px] font-bold text-[#14241D]">{item.name}</p>
          <p className="truncate text-[12px] font-semibold text-[#026B78]">{item.proc}</p>
        </div>
      </div>
      <Link
        href={item.contactId ? `/leads/${item.contactId}` : '/consultations'}
        className={cn(
          'mt-1 inline-flex items-center justify-center gap-1.5 rounded-[9px] px-3 py-1.5 text-[12.5px] font-semibold transition-colors',
          prep
            ? 'bg-[#14241D] text-[#FAF6EC] hover:bg-[#1E342A]'
            : 'bg-white border border-[#ECE4D4] text-[#4A5A60] hover:bg-[#0B2027]/5',
        )}
      >
        <C className="h-3.5 w-3.5" />
        {item.cta.label}
      </Link>
    </div>
  )
}

function OpenSlotTile({ range, label, note }: { range: string; label: string; note: string }) {
  return (
    <Link
      href="/settings"
      className="flex w-[168px] shrink-0 flex-col justify-between rounded-[14px] border border-dashed border-[#ECE4D4] p-3 transition-colors hover:border-[#02C39A] hover:bg-[#02C39A]/[0.04]"
    >
      <div>
        <p className="text-[13.5px] font-semibold text-[#14241D]">{range}</p>
        <p className="mt-0.5 text-[11.5px] text-[#7E8C90]">{label}</p>
      </div>
      <span className="mt-3 inline-flex items-center gap-1 text-[11.5px] font-semibold text-[#026B78]">
        <LinkIcon className="h-3 w-3" />
        {note}
      </span>
    </Link>
  )
}

function EmptySchedule() {
  return (
    <div className="flex items-center gap-4 rounded-[14px] border border-[#ECE4D4] bg-[#FBF8F0] px-5 py-6">
      <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-[#02C39A]/15">
        <CalendarHeart className="h-4 w-4 text-[#04B08C]" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold text-[#14241D]">Nothing booked today</p>
        <p className="text-[12.5px] text-[#7E8C90]">Want to share your booking link?</p>
      </div>
      <Link
        href="/settings"
        className="inline-flex items-center gap-1.5 rounded-[9px] bg-[#14241D] px-3 py-1.5 text-[12.5px] font-semibold text-[#FAF6EC] hover:bg-[#1E342A] transition-colors"
      >
        Share link
      </Link>
    </div>
  )
}
