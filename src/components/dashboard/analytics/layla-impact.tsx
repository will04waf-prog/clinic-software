'use client'

import { BarChart, Bar, ResponsiveContainer, XAxis, Tooltip } from 'recharts'
import {
  PhoneCall, PhoneOutgoing, TrendingUp, CalendarCheck, type LucideIcon,
} from 'lucide-react'
import { AnimatedNumber } from '@/components/ui/animated-number'
import '../ambient.css'

export interface LaylaImpactData {
  callsAnswered: number
  reminderCallsPlaced: number
  messagesCaptured: number
  transferredToStaff: number
  bookingsInRange: number
  bookingRevenueCents: number
  laylaAssistedBookings: number
  laylaAssistedRevenueCents: number
  noShowRate: number | null
  callOutcomes: { outcome: string; count: number }[]
  callsPerDay: { date: string; count: number }[]
}

// call_logs.outcome codes → owner-facing language.
const OUTCOME_LABELS: Record<string, string> = {
  completed:      'Resolved on the call',
  transferred:    'Transferred to you',
  voicemail:      'Message taken',
  safety_handoff: 'Safety handoff',
  no_consent:     'No recording consent',
  agent_error:    'Needs follow-up',
}

const money = (cents: number) => `$${Math.round(cents / 100).toLocaleString()}`

function Stat({ icon: Icon, value, label, sub }: {
  icon: LucideIcon; value: React.ReactNode; label: string; sub?: string
}) {
  return (
    // amb-sheen: one glassy sweep per hover (pointer-fine devices
    // only; see ambient.css). Pure overlay pseudo-element — the
    // AnimatedNumber layout is untouched.
    <div className="amb-sheen rounded-2xl border border-gray-200 bg-white p-5">
      <div className="flex items-center gap-2">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[#02C39A]/15 text-[#028090]">
          <Icon className="h-4 w-4" />
        </span>
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">{label}</span>
      </div>
      <div className="mt-3 text-3xl font-extrabold tracking-tight text-[#14241d] [font-variant-numeric:tabular-nums]">{value}</div>
      {sub && <p className="mt-1 text-xs text-gray-500 leading-snug">{sub}</p>}
    </div>
  )
}

/**
 * "Layla's impact" — the ROI section at the top of the dashboard's
 * Performance area. Leads with what she actually did for the owner:
 * calls answered, booking value, bookings from callers she spoke with,
 * reminder calls / no-show rate — plus a calls-per-day bar and an
 * outcome breakdown. Purely presentational; data comes from
 * /api/dashboard/analytics (laylaImpact).
 */
export function LaylaImpact({ data, days }: { data: LaylaImpactData; days: number }) {
  const empty = data.callsAnswered === 0 && data.bookingsInRange === 0
  const pl = (n: number) => (n === 1 ? '' : 's')

  return (
    <div className="rounded-2xl border border-[#02C39A]/25 bg-[#F5EFE1] p-6">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-[#02C39A]/40 bg-[#02C39A]/10 px-3 py-1">
            <PhoneCall className="h-3.5 w-3.5 text-[#14241d]" />
            <span className="text-xs font-semibold uppercase tracking-wider text-[#14241d]">Layla&apos;s impact</span>
          </div>
          <h3 className="mt-2 text-lg font-bold text-[#14241d]">What Layla did for you</h3>
        </div>
        <span className="shrink-0 text-xs text-gray-500">last {days} days</span>
      </div>

      {empty ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white/60 px-6 py-10 text-center">
          <PhoneCall className="mx-auto h-8 w-8 text-[#02C39A]" />
          <p className="mt-3 text-sm font-medium text-[#14241d]">Layla hasn&apos;t taken any calls in this window yet.</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-gray-500 leading-relaxed">
            As soon as she starts answering your business&apos;s phone, every call, booking, and message she
            handles shows up here.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat icon={PhoneCall} value={<AnimatedNumber value={data.callsAnswered} />} label="Calls answered"
              sub={`${data.messagesCaptured} message${pl(data.messagesCaptured)} taken · ${data.transferredToStaff} transferred`} />
            <Stat icon={TrendingUp} value={<AnimatedNumber value={data.bookingRevenueCents} format={money} />} label="Booking value"
              sub={`${data.bookingsInRange} consultation${pl(data.bookingsInRange)} booked`} />
            <Stat icon={CalendarCheck} value={<AnimatedNumber value={data.laylaAssistedBookings} />} label="Booked after a call"
              sub={`${money(data.laylaAssistedRevenueCents)} from callers Layla spoke with`} />
            <Stat icon={PhoneOutgoing} value={<AnimatedNumber value={data.reminderCallsPlaced} />} label="Reminder calls"
              sub={data.noShowRate != null ? `${Math.round(data.noShowRate * 100)}% no-show rate` : 'day-before confirmations'} />
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-[1.5fr_1fr]">
            <div className="rounded-2xl border border-gray-200 bg-white p-5">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Calls answered per day</p>
              <div className="h-40">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.callsPerDay} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9aa8a2' }}
                      tickFormatter={(d: string) => d.slice(5)} interval="preserveStartEnd" />
                    <Tooltip cursor={{ fill: 'rgba(2,195,154,0.08)' }}
                      contentStyle={{ borderRadius: 12, border: '1px solid rgba(2,195,154,0.3)', fontSize: 12 }} />
                    <Bar dataKey="count" radius={[4, 4, 0, 0]} fill="#02C39A" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-white p-5">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">What she did on those calls</p>
              {data.callOutcomes.length === 0 ? (
                <p className="text-sm text-gray-400">No calls yet.</p>
              ) : (
                <ul className="space-y-2.5">
                  {data.callOutcomes.map((o) => (
                    <li key={o.outcome} className="flex items-center justify-between text-sm">
                      <span className="text-gray-600">{OUTCOME_LABELS[o.outcome] ?? o.outcome}</span>
                      <span className="font-semibold text-[#14241d]">{o.count.toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
