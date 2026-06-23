'use client'
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

export type TimeseriesPoint = { date: string; count: number }
export type AnalyticsRange = '7d' | '30d' | '90d'

interface Props {
  data: TimeseriesPoint[]
  range: AnalyticsRange
  onRangeChange: (r: AnalyticsRange) => void
}

function parseLocalDate(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function formatShortDate(key: string): string {
  return parseLocalDate(key).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function formatLongDate(key: string): string {
  return parseLocalDate(key).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: Array<{ payload: TimeseriesPoint }>
}) {
  if (!active || !payload?.length) return null
  const point = payload[0].payload
  return (
    <div className="rounded-lg border border-[#0B2027]/10 bg-white px-3 py-2 text-xs shadow-md">
      <p className="font-semibold text-[#14241D]">{formatLongDate(point.date)}</p>
      <p className="text-[#7E8C90]">
        {point.count} new lead{point.count === 1 ? '' : 's'}
      </p>
    </div>
  )
}

const RANGES: { key: AnalyticsRange; label: string }[] = [
  { key: '7d',  label: '7d' },
  { key: '30d', label: '30d' },
  { key: '90d', label: '90d' },
]

export function TrendChart({ data, range, onRangeChange }: Props) {
  const total = data.reduce((sum, p) => sum + p.count, 0)

  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-baseline gap-3">
        <h2 className="text-[17px] font-bold text-[#14241D]">New leads</h2>
        <span className="text-[12.5px] text-[#7E8C90]">{total} captured · trend over time</span>
        <div className="ml-auto inline-flex rounded-full bg-white p-0.5 text-xs font-semibold shadow-[0_1px_2px_rgba(11,32,39,0.05)]">
          {RANGES.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => onRangeChange(key)}
              className={
                'rounded-full px-3 py-1 transition-colors ' +
                (range === key
                  ? 'bg-[#14241D] text-[#FAF6EC]'
                  : 'text-[#4A5A60] hover:text-[#14241D]')
              }
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      <div className="rounded-2xl bg-white p-4 shadow-[0_1px_2px_rgba(11,32,39,0.05)]">
        {total === 0 ? (
          <div className="flex h-[240px] items-center justify-center">
            <p className="text-sm text-[#7E8C90]">Not enough data yet for this range</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={data} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="trendGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#02C39A" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#02C39A" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                tickFormatter={formatShortDate}
                stroke="#A4AFB2"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                minTickGap={28}
              />
              <YAxis
                allowDecimals={false}
                stroke="#A4AFB2"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                width={28}
              />
              <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#0B2027', strokeOpacity: 0.08, strokeWidth: 1 }} />
              <Area
                type="monotone"
                dataKey="count"
                stroke="#028090"
                strokeWidth={2.2}
                fill="url(#trendGradient)"
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  )
}
