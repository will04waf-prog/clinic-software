'use client'

import { useState } from 'react'
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export type LeadsTimeseriesPoint = { date: string; count: number }

interface LeadsChartProps {
  data: LeadsTimeseriesPoint[]
}

type Range = '7' | '30' | '90'

// "YYYY-MM-DD" → local Date. Avoids the new Date(isoStr) UTC trap that
// can shift the day by one in negative-offset timezones.
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
    month:   'short',
    day:     'numeric',
  })
}

function CustomTooltip({
  active,
  payload,
}: {
  active?:  boolean
  payload?: Array<{ payload: LeadsTimeseriesPoint }>
}) {
  if (!active || !payload?.length) return null
  const point = payload[0].payload
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-gray-900">{formatLongDate(point.date)}</p>
      <p className="text-gray-500">
        {point.count} new lead{point.count === 1 ? '' : 's'}
      </p>
    </div>
  )
}

export function LeadsChart({ data }: LeadsChartProps) {
  const [range, setRange] = useState<Range>('30')
  const days     = Number(range)
  const filtered = data.slice(-days)
  const total    = filtered.reduce((sum, p) => sum + p.count, 0)

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div>
          <CardTitle>New Leads</CardTitle>
          <p className="mt-1 text-sm text-gray-500">Trend over time</p>
        </div>
        <div className="inline-flex rounded-full bg-gray-100 p-0.5 text-xs font-medium">
          {(['7', '30', '90'] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={
                'rounded-full px-3 py-1 transition-colors ' +
                (range === r
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-900')
              }
            >
              {r}d
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="pt-2">
        {total === 0 ? (
          <div className="flex h-[240px] items-center justify-center">
            <p className="text-sm text-gray-400">Not enough data yet</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={filtered} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="leadsGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor="#02C39A" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#02C39A" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                tickFormatter={formatShortDate}
                stroke="#9CA3AF"
                fontSize={12}
                tickLine={false}
                axisLine={false}
                minTickGap={24}
              />
              <YAxis
                allowDecimals={false}
                stroke="#9CA3AF"
                fontSize={12}
                tickLine={false}
                axisLine={false}
                width={28}
              />
              <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#E5E7EB', strokeWidth: 1 }} />
              <Area
                type="monotone"
                dataKey="count"
                stroke="#028090"
                strokeWidth={2}
                fill="url(#leadsGradient)"
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
}
