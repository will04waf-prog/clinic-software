import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { cached } from '@/lib/route-cache'

// Cache TTL aligned with the morning briefing — the dashboard tile
// refreshes on focus so a 30s window covers the worst-case poll burst.
const METRICS_CACHE_TTL_MS = 30_000

// Heuristic: every accepted draft (sent unchanged OR after edits) saves
// roughly 3 minutes of typing + thinking versus replying from scratch.
// Documented as a constant so reviewers know this isn't measured.
const MINUTES_SAVED_PER_DRAFT = 3

type DraftState =
  | 'pending'
  | 'sent'
  | 'edited'
  | 'rejected'
  | 'expired'
  | 'guardrail_failed'
  | 'auto_sent'

interface DraftRow {
  id: string
  state: DraftState
  draft_body: string
  rejection_reason: string | null
  generated_at: string
  edit_distance: number | null
}

interface PeriodCounts {
  drafts_generated_this_week: number
  sent_unchanged_count: number
  sent_edited_count: number
  auto_sent_count: number
  rejected_count: number
  guardrail_failed_count: number
}

interface RecentRejected {
  id: string
  draft_body_preview: string
  rejection_reason: string | null
  generated_at: string
}

export interface AiTwinMetricsResponse extends PeriodCounts {
  /** Mean edit distance across state='edited' drafts this week. 0 when none. */
  average_edit_distance: number
  /** Total hours saved this week (rounded to 1 decimal). */
  estimated_hours_saved: number
  top_5_recent_rejected: RecentRejected[]
  previous: PeriodCounts
}

function bucket(rows: DraftRow[]): PeriodCounts {
  const c: PeriodCounts = {
    drafts_generated_this_week: 0,
    sent_unchanged_count: 0,
    sent_edited_count: 0,
    auto_sent_count: 0,
    rejected_count: 0,
    guardrail_failed_count: 0,
  }
  for (const r of rows) {
    switch (r.state) {
      case 'sent':
        c.sent_unchanged_count += 1
        c.drafts_generated_this_week += 1
        break
      case 'edited':
        c.sent_edited_count += 1
        c.drafts_generated_this_week += 1
        break
      case 'auto_sent':
        c.auto_sent_count += 1
        c.drafts_generated_this_week += 1
        break
      case 'rejected':
        c.rejected_count += 1
        c.drafts_generated_this_week += 1
        break
      case 'guardrail_failed':
        c.guardrail_failed_count += 1
        c.drafts_generated_this_week += 1
        break
      // pending + expired excluded from counts — they never made it to
      // a human decision (expired is just an unattended timeout).
    }
  }
  return c
}

export async function GET(_req: NextRequest) {
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

  const cacheKey = `ai-twin-metrics:${orgId}`
  const payload = await cached<AiTwinMetricsResponse>(cacheKey, METRICS_CACHE_TTL_MS, () =>
    build(supabase, orgId),
  )
  return NextResponse.json(payload)
}

async function build(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
): Promise<AiTwinMetricsResponse> {
  const now = Date.now()
  const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString()
  const twoWeeksAgo = new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString()

  // Explicit organization_id eq() on every query — belt and braces
  // alongside the RLS policy on ai_drafts.
  const [thisWeekRes, lastWeekRes] = await Promise.all([
    supabase
      .from('ai_drafts')
      .select('id, state, draft_body, rejection_reason, generated_at, edit_distance')
      .eq('organization_id', orgId)
      .gte('generated_at', weekAgo),
    supabase
      .from('ai_drafts')
      .select('id, state, draft_body, rejection_reason, generated_at, edit_distance')
      .eq('organization_id', orgId)
      .gte('generated_at', twoWeeksAgo)
      .lt('generated_at', weekAgo),
  ])

  const thisWeek = (thisWeekRes.data ?? []) as DraftRow[]
  const lastWeek = (lastWeekRes.data ?? []) as DraftRow[]

  const current = bucket(thisWeek)
  const previous = bucket(lastWeek)

  // Mean edit distance, edited state only. Drafts with null edit_distance
  // (shouldn't happen for state='edited' but guard anyway) are skipped.
  const edited = thisWeek.filter(r => r.state === 'edited' && typeof r.edit_distance === 'number')
  const averageEdit = edited.length > 0
    ? Math.round(edited.reduce((sum, r) => sum + (r.edit_distance ?? 0), 0) / edited.length)
    : 0

  // Auto-sent drafts count toward "accepted" — they're outbound
  // SMS that went out and saved the staffer time (more than reviewed
  // drafts, even, since no human was in the loop).
  const acceptedThisWeek = current.sent_unchanged_count + current.sent_edited_count + current.auto_sent_count
  const hoursSaved = Math.round((acceptedThisWeek * MINUTES_SAVED_PER_DRAFT) / 6) / 10

  const top5 = thisWeek
    .filter(r => r.state === 'rejected')
    .sort((a, b) => b.generated_at.localeCompare(a.generated_at))
    .slice(0, 5)
    .map<RecentRejected>(r => ({
      id: r.id,
      draft_body_preview: (r.draft_body ?? '').slice(0, 120),
      rejection_reason: r.rejection_reason,
      generated_at: r.generated_at,
    }))

  return {
    ...current,
    average_edit_distance: averageEdit,
    estimated_hours_saved: hoursSaved,
    top_5_recent_rejected: top5,
    previous,
  }
}
