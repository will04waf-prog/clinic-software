import Link from 'next/link'
import {
  ArrowUpRight, MessageCircle, NotepadText, RotateCcw, Send, Moon, Zap, Sparkles,
  Clock, CalendarCheck, CalendarDays, Wind, Info, Inbox, Sprout,
} from 'lucide-react'
import { SourcePill } from '@/components/leads/source-pill'
import { InitialAvatar } from './initial-avatar'
import type { ActionRow, TagTone, Urgency } from './types'
import { cn } from '@/lib/utils'

/**
 * The action stack — vertical list of ranked triage cards. This is the
 * centerpiece of the dashboard. Each row is one thing the clinic should
 * do right now: reply to a hot lead, prep a consult, follow up on a
 * cooling lead, enroll a batch of unenrolled leads in a sequence.
 *
 * Urgency color rail on the left, avatar (or system glyph), body
 * (name + procedure + source + tag, message line, "why" footnote),
 * primary + secondary CTA on the right.
 *
 * Empty state shows a friendly line, never blank space — matches the
 * "no urgent actions — nice work" spec.
 */

const URGENCY_BAR: Record<Urgency, string> = {
  now:   'bg-[#02C39A]',
  soon:  'bg-[#028090]',
  today: 'bg-[#14241D]',
  cool:  'bg-[#B5710F]',
  auto:  'bg-[#02C39A]',
}

const TAG_TONE: Record<TagTone, string> = {
  mint:  'bg-[#02C39A]/15 text-[#04B08C]',
  teal:  'bg-[#028090]/12 text-[#026B78]',
  navy:  'bg-[#0B2027]/8  text-[#0B2027]',
  amber: 'bg-[#B5710F]/13 text-[#9A5F0B]',
}

const ICONS: Record<string, React.ComponentType<{ className?: string; fill?: string }>> = {
  'message-circle':   MessageCircle,
  'arrow-up-right':   ArrowUpRight,
  'note-pencil':      NotepadText,
  rotate:             RotateCcw,
  send:               Send,
  moon:               Moon,
  lightning:          Zap,
  zap:                Zap,
  sparkle:            Sparkles,
  sparkles:           Sparkles,
  clock:              Clock,
  'calendar-check':   CalendarCheck,
  'calendar-blank':   CalendarDays,
  wind:               Wind,
  info:               Info,
  inbox:              Inbox,
  path:               Sprout,
}

function Icon({ name, className }: { name: string; className?: string }) {
  const C = ICONS[name] ?? Info
  return <C className={className} />
}

interface Props {
  actions: ActionRow[]
}

export function ActionStack({ actions }: Props) {
  const count = actions.length

  return (
    // Per the screenshots, the action stack has no "Needs you" section
    // heading — it just starts. Section labels appear only on "Today"
    // and "This week" below.
    <section className="flex flex-col gap-3">
      {count === 0 ? (
        <EmptyState />
      ) : (
        <ul className="flex flex-col gap-3">
          {actions.map(a => (
            <ActionCard key={a.id} action={a} />
          ))}
        </ul>
      )}
    </section>
  )
}

function ActionCard({ action }: { action: ActionRow }) {
  return (
    <li className="relative flex items-center gap-[15px] rounded-[14px] bg-white px-5 py-[18px] pl-[24px] shadow-[0_1px_2px_rgba(11,32,39,0.05)] transition-shadow hover:shadow-[0_4px_16px_-6px_rgba(11,32,39,0.12)]">
      {/* Urgency rail */}
      <span
        className={cn(
          'absolute left-0 top-3 bottom-3 w-[3px] rounded-r',
          URGENCY_BAR[action.urg],
        )}
      />

      {/* Avatar or system glyph */}
      {action.kind === 'lead' && action.initials && action.tint ? (
        <InitialAvatar initials={action.initials} tint={action.tint} size="lg" />
      ) : (
        <span className="inline-flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-xl bg-[#02C39A]/15 text-[#04B08C]">
          <Sprout className="h-5 w-5" />
        </span>
      )}

      {/* Body */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[14.5px] font-bold text-[#14241D]">{action.name}</span>
          {action.proc && (
            <>
              <span className="text-[#7E8C90]" aria-hidden>·</span>
              <span className="text-[12.5px] font-semibold text-[#026B78]">{action.proc}</span>
            </>
          )}
          {action.source && (
            <SourcePill source={action.source} className="!py-0" />
          )}
          <span className="ml-auto" />
          <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-bold', TAG_TONE[action.tag.tone])}>
            <Icon name={action.tag.icon} className="h-3 w-3" />
            {action.tag.label}
          </span>
        </div>
        <p className="mt-1.5 truncate text-[13.5px] text-[#0B2027]">{action.msg}</p>
        <p className="mt-1 flex items-center gap-1.5 text-[12px] text-[#7E8C90]">
          <Info className="h-3 w-3" fill="currentColor" />
          {action.why}
        </p>
      </div>

      {/* CTAs */}
      <div className="flex shrink-0 items-center gap-2">
        <Link
          href={action.href}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-[9px] px-3 py-1.5 text-[13px] font-semibold transition-colors',
            action.primary.kind === 'forest'
              ? 'bg-[#14241D] text-[#FAF6EC] shadow-[0_6px_16px_-9px_rgba(20,36,29,0.7)] hover:bg-[#1E342A]'
              : 'bg-[#02C39A] text-[#0B2027] hover:bg-[#04B08C]',
          )}
        >
          <Icon name={action.primary.icon} className="h-3.5 w-3.5" />
          {action.primary.label}
        </Link>
        <Link
          href={action.hrefSecondary ?? action.href}
          className="inline-flex items-center gap-1.5 rounded-[9px] px-3 py-1.5 text-[13px] font-semibold text-[#4A5A60] hover:bg-[#0B2027]/5 transition-colors"
        >
          <Icon name={action.secondary.icon} className="h-3.5 w-3.5" />
          {action.secondary.label}
        </Link>
      </div>
    </li>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-[14px] bg-white px-6 py-12 text-center shadow-[0_1px_2px_rgba(11,32,39,0.05)]">
      <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-[#02C39A]/15">
        <Sparkles className="h-4 w-4 text-[#04B08C]" fill="currentColor" />
      </span>
      <p className="text-[14px] font-semibold text-[#14241D]">No urgent actions — nice work</p>
      <p className="text-[12.5px] text-[#7E8C90]">Inbox is clear, every consult is prepped, and no leads are cooling off.</p>
    </div>
  )
}
