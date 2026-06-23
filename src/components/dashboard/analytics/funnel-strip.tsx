import { Users, MessageCircle, CalendarCheck, UserCheck, ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'

interface FunnelStage {
  key: string
  label: string
  value: number
  sub: string
}

interface Props {
  funnel: FunnelStage[]
  days: number
}

/**
 * Funnel strip: Captured → Engaged → Booked → Patients. Each stage
 * shows count, label, and a percentage of the top-of-funnel (captured).
 * Arrows between stages convey the drop-off.
 */

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  captured: Users,
  engaged:  MessageCircle,
  booked:   CalendarCheck,
  patients: UserCheck,
}

export function FunnelStrip({ funnel }: Props) {
  const top = funnel[0]?.value ?? 0
  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-baseline gap-3">
        <h2 className="text-[17px] font-bold text-[#14241D]">Conversion funnel</h2>
        <span className="text-[12.5px] text-[#7E8C90]">Lead → patient over the period</span>
      </header>

      <div className="rounded-2xl bg-white p-5 shadow-[0_1px_2px_rgba(11,32,39,0.05)]">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch lg:gap-2">
          {funnel.map((stage, i) => {
            const Icon = ICONS[stage.key] ?? Users
            const pct = top > 0 ? Math.round((stage.value / top) * 100) : 0
            const isFirst = i === 0
            const isLast = i === funnel.length - 1
            return (
              <div key={stage.key} className="flex flex-1 items-stretch gap-2">
                <div className={cn(
                  'flex flex-1 flex-col gap-2 rounded-xl border border-[#0B2027]/8 px-4 py-3.5',
                  isFirst ? 'bg-[#02C39A]/[0.08]' : 'bg-[#FBF8F0]'
                )}>
                  <div className="flex items-center justify-between">
                    <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-[#02C39A]/15">
                      <Icon className="h-3.5 w-3.5 text-[#04B08C]" />
                    </span>
                    {!isFirst && (
                      <span className="text-[11px] font-semibold text-[#4A5A60]">
                        {pct}% of captured
                      </span>
                    )}
                  </div>
                  <p
                    className="text-[#14241D]"
                    style={{
                      fontFamily: 'var(--font-newsreader), Newsreader, Georgia, serif',
                      fontSize: '26px',
                      fontWeight: 600,
                      lineHeight: 1,
                    }}
                  >
                    {stage.value}
                  </p>
                  <div>
                    <p className="text-[12.5px] font-semibold text-[#14241D]">{stage.label}</p>
                    <p className="text-[11.5px] text-[#7E8C90]">{stage.sub}</p>
                  </div>
                </div>
                {!isLast && (
                  <div className="hidden lg:flex items-center justify-center px-1">
                    <ArrowRight className="h-4 w-4 text-[#0B2027]/30" strokeWidth={2.4} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
