import { Zap } from 'lucide-react'

/**
 * Mockup-matched stat strip at the top of the leads list.
 *
 * INTENTIONALLY STATIC PLACEHOLDER. The values displayed are not computed
 * from real data yet — this is the visual-polish pass landing the design
 * direction. A follow-up commit will wire the real average from
 * activity_log (lead_captured → first outbound message latency).
 */
export function TimeToFirstContactCard() {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-[#0B2027]/8 bg-white px-4 py-3 shadow-[0_1px_2px_rgba(11,32,39,0.04)]">
      <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-[#02C39A]/15">
        <Zap className="h-4 w-4 text-[#02C39A]" strokeWidth={2.4} />
      </span>
      <div className="flex flex-1 flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#0B2027]/60">
          Average time to first contact
        </span>
        <span className="font-serif text-2xl font-semibold leading-none text-[#0B2027]">
          47<span className="text-base font-medium text-[#0B2027]/70">s</span>
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-[#02C39A]/12 px-2 py-0.5 text-[11px] font-medium text-[#028090]">
          <span aria-hidden="true">↓</span>
          12s faster than last week
        </span>
      </div>
    </div>
  )
}
