import { ArrowRight, ArrowUp, ArrowDown, CalendarCheck, Zap, Target, Wallet } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { WeekPrimitive } from './types'

/**
 * Compressed week-at-a-glance strip — the only survivor of the old
 * KPI grid. Small primitives, not big stat tiles. Each cell shows an
 * icon, a delta chip (mint = good, amber = bad), the value, label,
 * and sub-line.
 *
 * Phase 1 ships 3 cells (new bookings, speed-to-first-contact,
 * booking conversion). Revenue is deferred until pricing data is
 * actually wired.
 */

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  'calendar-check': CalendarCheck,
  lightning: Zap,
  zap: Zap,
  target: Target,
  wallet: Wallet,
}

interface Props {
  week: WeekPrimitive[]
}

export function WeekStrip({ week }: Props) {
  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-baseline gap-3">
        <h2 className="text-[17px] font-bold text-[#14241D]">This week</h2>
        <span className="text-[12.5px] text-[#7E8C90]">Mon – Sun</span>
        {/* Analytics now lives below the week strip on the same page —
            this is a smooth in-page anchor jump to #performance, not a
            route change. */}
        <a
          href="#performance"
          className="ml-auto inline-flex items-center gap-1 text-[12.5px] font-semibold text-[#026B78] hover:text-[#028090]"
        >
          See analytics
          <ArrowRight className="h-3 w-3" strokeWidth={2.4} />
        </a>
      </header>

      <div className="grid gap-3.5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        {week.map((p, i) => <WeekCell key={i} p={p} idx={i} />)}
      </div>
    </section>
  )
}

function WeekCell({ p, idx }: { p: WeekPrimitive; idx: number }) {
  const Icon = ICONS[p.icon] ?? Zap
  const isUp = p.delta.dir === 'up'
  const DeltaArrow = isUp ? ArrowUp : ArrowDown
  return (
    <div className="rise flex flex-col gap-2 rounded-[14px] bg-white px-[17px] pb-4 pt-[15px] shadow-[0_1px_2px_rgba(11,32,39,0.05)] transition-shadow hover:shadow-[0_4px_16px_-6px_rgba(11,32,39,0.10)]" style={{ '--stagger': idx } as React.CSSProperties}>
      <div className="flex items-center justify-between">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] bg-[#02C39A]/15">
          <Icon className="h-4 w-4 text-[#04B08C]" />
        </span>
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-bold',
            p.delta.tone === 'mint'
              ? 'bg-[#02C39A]/15 text-[#04B08C]'
              : 'bg-[#B5710F]/13 text-[#9A5F0B]',
          )}
        >
          <DeltaArrow className="h-3 w-3" strokeWidth={2.6} />
          {p.delta.text}
        </span>
      </div>
      <p
        className="text-[#14241D]"
        style={{
          fontFamily: 'var(--font-newsreader), Newsreader, Georgia, serif',
          fontSize: '30px',
          fontWeight: 600,
          lineHeight: 1,
        }}
      >
        {p.value}
      </p>
      <div>
        <p className="text-[12px] font-semibold text-[#4A5A60]">
          {p.label}
          {p.placeholder && (
            <span className="ml-1.5 inline-flex items-center rounded-full bg-[#0B2027]/8 px-1.5 py-0 text-[9px] font-bold uppercase tracking-wider text-[#4A5A60]">
              Demo
            </span>
          )}
        </p>
        <p className="text-[11.5px] text-[#7E8C90]">{p.sub}</p>
      </div>
    </div>
  )
}
