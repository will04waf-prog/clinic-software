import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { cached } from '@/lib/route-cache'
import { aggregateLaylaImpact } from '@/lib/analytics/layla-impact-agg'
import type { LeadSource } from '@/types'

// 30s in-memory cache, keyed per (org, range). Analytics aggregation
// is heavy (4 parallel queries that scan contacts+messages+consults
// across up to 90 days) and the values barely move minute-to-minute.
const ANALYTICS_CACHE_TTL_MS = 30_000

/**
 * GET /api/dashboard/analytics?range=7d|30d|90d
 *
 * Aggregated analytics for the /analytics page. Three sections:
 *   1. timeseries — leads per day across the selected range
 *   2. funnel     — Contacts captured → Leads with messages →
 *                   Consultations booked → Patients
 *   3. sources    — count of contacts created in the range, grouped
 *                   by `source`. Drives the source-breakdown bar list.
 *
 * Org-isolated via RLS + explicit org_id filter on every query.
 */

type Range = '7d' | '30d' | '90d'
const VALID_RANGES: Range[] = ['7d', '30d', '90d']

function rangeDays(r: Range): number {
  return r === '7d' ? 7 : r === '30d' ? 30 : 90
}

function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single()
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  const orgId = profile.organization_id

  const rangeParam = new URL(req.url).searchParams.get('range') as Range | null
  const range: Range = rangeParam && VALID_RANGES.includes(rangeParam) ? rangeParam : '30d'
  const days = rangeDays(range)

  const cacheKey = `analytics:${orgId}:${range}`
  const payload = await cached(cacheKey, ANALYTICS_CACHE_TTL_MS, () => buildAnalyticsPayload(supabase, orgId, range, days))
  return NextResponse.json(payload)
}

async function buildAnalyticsPayload(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
  range: Range,
  days: number,
) {
  const now = new Date()
  const startLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1))
  const startIso = startLocal.toISOString()

  const [contactsRes, messagesRes, consultsRes, patientsRes, callLogsRes] = await Promise.all([
    // Every contact created in the range — used for timeseries +
    // source-breakdown.
    supabase
      .from('contacts')
      .select('id, created_at, source')
      .eq('organization_id', orgId)
      .gte('created_at', startIso),
    // Distinct contact_ids that have any messages in the range — funnel
    // step 2 ("leads with messages").
    supabase
      .from('messages')
      .select('contact_id')
      .eq('organization_id', orgId)
      .gte('created_at', startIso),
    // Consultations created in the range — funnel step 3 (+ service
    // price and status for the Layla ROI section).
    supabase
      .from('consultations')
      .select('id, contact_id, status, service:services(price_cents)')
      .eq('organization_id', orgId)
      .gte('created_at', startIso),
    // Contacts that moved to status='patient' in the range — funnel
    // step 4. We don't track a status_changed_at timestamp, so this
    // currently counts contacts whose CURRENT status is 'patient' AND
    // were created in the range. Honest approximation, not exact.
    supabase
      .from('contacts')
      .select('id')
      .eq('organization_id', orgId)
      .eq('status', 'patient')
      .gte('created_at', startIso),
    // Layla's calls in the range — powers the ROI / impact section.
    supabase
      .from('call_logs')
      .select('direction, outcome, started_at, contact_id')
      .eq('organization_id', orgId)
      .gte('started_at', startIso),
  ])

  const contacts = contactsRes.data ?? []

  // ── Timeseries: one bucket per day in the range, zero-filled ──
  const buckets = new Map<string, number>()
  for (let i = 0; i < days; i++) {
    buckets.set(toDateKey(new Date(startLocal.getTime() + i * 86_400_000)), 0)
  }
  for (const c of contacts) {
    const key = toDateKey(new Date(c.created_at))
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1)
  }
  const timeseries = Array.from(buckets, ([date, count]) => ({ date, count }))

  // ── Funnel ──────────────────────────────────────────────
  const totalContacts = contacts.length
  const distinctContactsWithMessages = new Set(
    (messagesRes.data ?? []).map(m => m.contact_id).filter(Boolean) as string[]
  ).size
  const consultsBooked = (consultsRes.data ?? []).length
  const newPatients = (patientsRes.data ?? []).length

  const funnel = [
    {
      key: 'captured',
      label: 'Contacts captured',
      value: totalContacts,
      sub: `over the last ${days} days`,
    },
    {
      key: 'engaged',
      label: 'Leads with messages',
      value: distinctContactsWithMessages,
      sub: 'inbound or outbound SMS',
    },
    {
      key: 'booked',
      label: 'Consultations booked',
      value: consultsBooked,
      sub: 'across this period',
    },
    {
      key: 'patients',
      label: 'New patients',
      value: newPatients,
      sub: 'moved from lead to patient',
    },
  ]

  // ── Source breakdown ────────────────────────────────────
  const sourceCounts = new Map<LeadSource | 'unknown', number>()
  for (const c of contacts) {
    const s = (c.source as LeadSource | null) ?? 'unknown'
    sourceCounts.set(s, (sourceCounts.get(s) ?? 0) + 1)
  }
  const sources = Array.from(sourceCounts, ([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count)

  // ── Layla impact / ROI ──────────────────────────────────
  // call_logs rows exist only when Layla handled a call, so inbound
  // counts are an unambiguous "calls Layla answered". The scalar math
  // (incl. the honest two-way revenue attribution) lives in the shared
  // aggregator so the weekly owner digest reports the exact numbers
  // this dashboard shows; only the per-day chart buckets live here.
  const calls = callLogsRes.data ?? []
  const consults = consultsRes.data ?? []
  const agg = aggregateLaylaImpact(consults, calls)

  const inboundCalls = calls.filter((c) => c.direction === 'inbound')
  const callBuckets = new Map<string, number>()
  for (let i = 0; i < days; i++) {
    callBuckets.set(toDateKey(new Date(startLocal.getTime() + i * 86_400_000)), 0)
  }
  for (const c of inboundCalls) {
    const key = toDateKey(new Date(c.started_at))
    if (callBuckets.has(key)) callBuckets.set(key, (callBuckets.get(key) ?? 0) + 1)
  }
  const callsPerDay = Array.from(callBuckets, ([date, count]) => ({ date, count }))

  const laylaImpact = { ...agg, callsPerDay }

  return {
    range,
    days,
    totalContacts,
    timeseries,
    funnel,
    sources,
    laylaImpact,
  }
}
