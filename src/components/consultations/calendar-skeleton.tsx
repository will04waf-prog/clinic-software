'use client'

/**
 * Loading skeleton for the calendar grid. Mirrors the grid's
 * structure (hour rail + day columns) so the LCP shift when real
 * data arrives is minimal.
 */

export function CalendarSkeleton({ dayCount }: { dayCount: number }) {
  return (
    <div className="rounded-xl border border-[#0B2027]/10 bg-white">
      <div
        className="grid animate-pulse border-b border-[#0B2027]/10"
        style={{ gridTemplateColumns: `60px repeat(${dayCount}, minmax(0, 1fr))` }}
      >
        <div />
        {Array.from({ length: dayCount }).map((_, i) => (
          <div key={i} className="px-2 py-2">
            <div className="mx-auto h-3 w-12 rounded bg-gray-200" />
          </div>
        ))}
      </div>
      <div
        className="grid animate-pulse"
        style={{
          gridTemplateColumns: `60px repeat(${dayCount}, minmax(0, 1fr))`,
          gridTemplateRows:    'repeat(14, minmax(56px, 1fr))',
        }}
      >
        {Array.from({ length: 14 }).map((_, i) => (
          <div key={`row-${i}`} className="col-start-1 border-t border-[#0B2027]/5 px-1.5 pt-1">
            <div className="h-2 w-8 rounded bg-gray-100" />
          </div>
        ))}
        {Array.from({ length: dayCount }).map((_, col) => (
          <div
            key={`col-${col}`}
            className="relative border-l border-[#0B2027]/5"
            style={{ gridColumn: col + 2, gridRow: '1 / 15' }}
          >
            <div className="absolute left-1 right-1 top-[12%] h-10 rounded bg-gray-100" />
            <div className="absolute left-1 right-1 top-[35%] h-8 rounded bg-gray-100" />
            <div className="absolute left-1 right-1 top-[60%] h-12 rounded bg-gray-100" />
          </div>
        ))}
      </div>
    </div>
  )
}
