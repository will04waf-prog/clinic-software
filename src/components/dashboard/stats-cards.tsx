'use client'
import { Users, CalendarCheck, TrendingUp, AlertCircle, UserPlus, RefreshCw } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import type { DashboardStats } from '@/types'

interface StatsCardsProps {
  stats: DashboardStats
}

export function StatsCards({ stats }: StatsCardsProps) {
  const cards = [
    {
      label: 'New Leads Today',
      value: stats.new_leads_today,
      sub: `${stats.new_leads_week} this week`,
      icon: UserPlus,
      color: 'text-indigo-600',
      bg: 'bg-indigo-50',
    },
    {
      label: 'Consultations Today',
      value: stats.consultations_today,
      sub: `${stats.consultations_week} this week`,
      icon: CalendarCheck,
      color: 'text-emerald-600',
      bg: 'bg-emerald-50',
    },
    {
      label: 'No-Shows This Week',
      value: stats.no_shows_week,
      sub: 'Needs recovery workflow',
      icon: AlertCircle,
      color: 'text-amber-600',
      bg: 'bg-amber-50',
    },
    {
      label: 'Active Leads',
      value: stats.total_active_leads,
      sub: `${stats.total_contacts} total contacts`,
      icon: Users,
      color: 'text-blue-600',
      bg: 'bg-blue-50',
    },
    {
      label: 'Conversion Rate',
      value: `${stats.conversion_rate.toFixed(1)}%`,
      sub: 'Lead → Consultation',
      icon: TrendingUp,
      color: 'text-purple-600',
      bg: 'bg-purple-50',
    },
  ]

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
      {cards.map((card) => (
        <Card key={card.label}>
          <CardContent className="pt-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-2xl font-bold text-gray-900">{card.value}</p>
                <p className="mt-1 text-xs font-medium text-gray-600">{card.label}</p>
                <p className="mt-0.5 text-xs text-gray-400">{card.sub}</p>
              </div>
              <div className={`rounded-lg p-2 ${card.bg}`}>
                <card.icon className={`h-4 w-4 ${card.color}`} />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
