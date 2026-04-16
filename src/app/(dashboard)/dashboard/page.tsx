import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/header'
import { StatsCards } from '@/components/dashboard/stats-cards'
import { OnboardingChecklist } from '@/components/dashboard/onboarding-checklist'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatRelative, formatDateTime } from '@/lib/utils'
import type { DashboardStats } from '@/types'
import Link from 'next/link'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://tarhunna.net'

type SupabaseClient = Awaited<ReturnType<typeof createClient>>

const EMPTY_STATS: DashboardStats = {
  new_leads_today: 0,
  new_leads_week: 0,
  consultations_today: 0,
  consultations_week: 0,
  no_shows_week: 0,
  conversion_rate: 0,
  total_active_leads: 0,
  total_contacts: 0,
}

async function getDashboardData(supabase: SupabaseClient, orgId: string) {
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
  const startOfWeek  = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const endOfToday   = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()

  const [
    r0, r1, r2, r3, r4, r5, r6, r7, r8, r9, r10, r11,
  ] = await Promise.all([
    supabase.from('contacts').select('*', { count: 'exact', head: true }).eq('organization_id', orgId).gte('created_at', startOfToday),
    supabase.from('contacts').select('*', { count: 'exact', head: true }).eq('organization_id', orgId).gte('created_at', startOfWeek),
    supabase.from('consultations').select('*', { count: 'exact', head: true }).eq('organization_id', orgId).gte('scheduled_at', startOfToday).lt('scheduled_at', endOfToday),
    supabase.from('consultations').select('*', { count: 'exact', head: true }).eq('organization_id', orgId).gte('scheduled_at', startOfWeek),
    supabase.from('consultations').select('*', { count: 'exact', head: true }).eq('organization_id', orgId).eq('status', 'no_show').gte('scheduled_at', startOfWeek),
    supabase.from('contacts').select('*', { count: 'exact', head: true }).eq('organization_id', orgId).eq('status', 'lead').eq('is_archived', false),
    supabase.from('contacts').select('*', { count: 'exact', head: true }).eq('organization_id', orgId).eq('is_archived', false),
    supabase.from('consultations').select('*', { count: 'exact', head: true }).eq('organization_id', orgId).eq('status', 'completed'),
    supabase.from('contacts').select('*, stage:pipeline_stages(*)').eq('organization_id', orgId).order('created_at', { ascending: false }).limit(5),
    supabase.from('consultations').select('*, contact:contacts(first_name, last_name)').eq('organization_id', orgId).gte('scheduled_at', now.toISOString()).order('scheduled_at', { ascending: true }).limit(5),
    // Onboarding: total consultations (any status)
    supabase.from('consultations').select('*', { count: 'exact', head: true }).eq('organization_id', orgId),
    // Onboarding: active automations with at least one step
    supabase.from('automation_sequences').select('id, sequence_steps!inner(id)', { count: 'exact', head: true }).eq('organization_id', orgId).eq('is_active', true),
  ])

  const totalContacts = r6.count ?? 0
  const totalDone     = r7.count ?? 0

  const stats: DashboardStats = {
    new_leads_today:      r0.count ?? 0,
    new_leads_week:       r1.count ?? 0,
    consultations_today:  r2.count ?? 0,
    consultations_week:   r3.count ?? 0,
    no_shows_week:        r4.count ?? 0,
    total_active_leads:   r5.count ?? 0,
    total_contacts:       totalContacts,
    conversion_rate:      totalContacts > 0 ? (totalDone / totalContacts) * 100 : 0,
  }

  return {
    stats,
    recentLeads:      r8.data ?? [],
    upcomingConsults: r9.data ?? [],
    hasLeads:         (r6.count ?? 0) > 0,
    hasConsultations: (r10.count ?? 0) > 0,
    hasAutomations:   (r11.count ?? 0) > 0,
  }
}

export default async function DashboardPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id, full_name, organization:organizations(id, name, slug)')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/login')

  // Fetch dashboard data — never crash the page on a query error
  let stats = EMPTY_STATS
  let recentLeads:      any[] = []
  let upcomingConsults: any[] = []
  let hasLeads         = false
  let hasConsultations = false
  let hasAutomations   = false
  let dataError: string | null = null

  try {
    const result = await getDashboardData(supabase, profile.organization_id)
    stats            = result.stats
    recentLeads      = result.recentLeads
    upcomingConsults = result.upcomingConsults
    hasLeads         = result.hasLeads
    hasConsultations = result.hasConsultations
    hasAutomations   = result.hasAutomations
  } catch (err: any) {
    console.error('[dashboard] data fetch error:', err.message)
    dataError = err.message
  }

  const org = (profile as any).organization
  const captureUrl = `${APP_URL}/capture/${org?.slug ?? ''}`

  return (
    <div className="flex flex-col overflow-hidden h-full">
      <Header
        title={`Good ${getGreeting()}, ${profile.full_name.split(' ')[0]}`}
        subtitle={org?.name}
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {dataError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
            <p className="text-sm font-medium text-red-700">Could not load dashboard data</p>
            <p className="text-xs text-red-500 mt-0.5">{dataError}</p>
          </div>
        )}

        <OnboardingChecklist
          hasLeads={hasLeads}
          hasConsultations={hasConsultations}
          hasAutomations={hasAutomations}
          captureUrl={captureUrl}
        />

        <StatsCards stats={stats} />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Recent Leads */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle>Recent Leads</CardTitle>
              <Link href="/leads" className="text-xs text-indigo-600 hover:underline">View all</Link>
            </CardHeader>
            <CardContent className="pt-0">
              {recentLeads.length === 0 ? (
                <p className="text-sm text-gray-400 py-4 text-center">No leads yet</p>
              ) : (
                <div className="divide-y divide-gray-100">
                  {recentLeads.map((lead: any) => (
                    <div key={lead.id} className="flex items-center justify-between py-3">
                      <div>
                        <Link href={`/leads/${lead.id}`} className="text-sm font-medium text-gray-900 hover:text-indigo-600">
                          {lead.first_name} {lead.last_name}
                        </Link>
                        <p className="text-xs text-gray-400">{lead.email ?? lead.phone ?? '—'}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {lead.stage && (
                          <span
                            className="rounded-full px-2 py-0.5 text-xs font-medium"
                            style={{ backgroundColor: `${lead.stage.color}20`, color: lead.stage.color }}
                          >
                            {lead.stage.name}
                          </span>
                        )}
                        <span className="text-xs text-gray-400">{formatRelative(lead.created_at)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Upcoming Consultations */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle>Upcoming Consultations</CardTitle>
              <Link href="/consultations" className="text-xs text-indigo-600 hover:underline">View all</Link>
            </CardHeader>
            <CardContent className="pt-0">
              {upcomingConsults.length === 0 ? (
                <p className="text-sm text-gray-400 py-4 text-center">No upcoming consultations</p>
              ) : (
                <div className="divide-y divide-gray-100">
                  {upcomingConsults.map((consult: any) => (
                    <div key={consult.id} className="flex items-center justify-between py-3">
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {consult.contact?.first_name} {consult.contact?.last_name}
                        </p>
                        <p className="text-xs text-gray-400">{formatDateTime(consult.scheduled_at)}</p>
                      </div>
                      <Badge variant={consult.status === 'confirmed' ? 'success' : 'default'}>
                        {consult.type === 'virtual' ? 'Virtual' : 'In-Person'}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function getGreeting() {
  const h = new Date().getHours()
  if (h < 12) return 'morning'
  if (h < 17) return 'afternoon'
  return 'evening'
}
