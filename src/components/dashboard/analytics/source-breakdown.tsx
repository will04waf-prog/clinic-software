import { SourcePill } from '@/components/leads/source-pill'
import type { LeadSource } from '@/types'

interface SourceRow {
  key: LeadSource | 'unknown'
  count: number
}

interface Props {
  sources: SourceRow[]
  totalContacts: number
  days: number
}

/**
 * Lead-source breakdown. Horizontal bars colored by source, ordered
 * by count. If totalContacts is 0 we render a friendly empty state
 * instead of a row of 0-bars.
 */
export function SourceBreakdown({ sources, totalContacts, days }: Props) {
  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-baseline gap-3">
        <h2 className="text-[17px] font-bold text-[#14241D]">Where leads came from</h2>
        <span className="text-[12.5px] text-[#7E8C90]">Last {days} days · {totalContacts} captured</span>
      </header>

      <div className="rounded-2xl bg-white p-5 shadow-[0_1px_2px_rgba(11,32,39,0.05)]">
        {totalContacts === 0 ? (
          <div className="py-6 text-center">
            <p className="text-[13px] font-semibold text-[#14241D]">No leads captured in this range</p>
            <p className="mt-1 text-[12px] text-[#7E8C90]">
              Once leads come in, you&apos;ll see where they came from here.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {sources.map(({ key, count }) => {
              const pct = Math.round((count / totalContacts) * 100)
              const isUnknown = key === 'unknown'
              return (
                <li key={key} className="flex items-center gap-3">
                  <div className="w-28 shrink-0">
                    {isUnknown ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[#0B2027]/8 px-1.5 py-0.5 text-[11px] font-medium text-[#4A5A60]">
                        No source
                      </span>
                    ) : (
                      <SourcePill source={key as LeadSource} />
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="h-[10px] w-full rounded-full bg-[#0B2027]/5 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-[#02C39A]"
                        style={{ width: `${Math.max(pct, 2)}%` }}
                      />
                    </div>
                  </div>
                  <div className="flex w-24 shrink-0 items-baseline justify-end gap-1.5 text-right">
                    <span className="text-[14px] font-bold text-[#14241D] tabular-nums">{count}</span>
                    <span className="text-[11.5px] text-[#7E8C90] tabular-nums">{pct}%</span>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}
