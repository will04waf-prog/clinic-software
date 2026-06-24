import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/ai-drafts/list?state=&page=
 *
 * Paginated audit list of every AI draft the org has produced. Powers
 * the /ai-drafts/review page. Org isolation via RLS + explicit
 * organization_id filter; no service-role bypass needed.
 */

const PAGE_SIZE = 50

const StateFilter = z.enum(['all', 'sent', 'edited', 'rejected', 'blocked', 'auto_sent'])

const QuerySchema = z.object({
  state: StateFilter.optional().default('all'),
  page: z.coerce.number().int().min(0).optional().default(0),
})

type DraftStateCol =
  | 'pending'
  | 'sent'
  | 'edited'
  | 'rejected'
  | 'expired'
  | 'guardrail_failed'
  | 'auto_sent'

export interface DraftRow {
  id: string
  contact_id: string
  contact_first_name: string | null
  contact_last_name: string | null
  draft_body: string
  /** Body of the actual outbound message, or null when the draft wasn't sent. */
  sent_message_body: string | null
  edit_distance: number | null
  rejection_reason: string | null
  guardrail_violation: string | null
  state: DraftStateCol
  generated_at: string
  resolved_at: string | null
}

export interface DraftListResponse {
  rows: DraftRow[]
  total: number
  page: number
  page_size: number
}

interface JoinedRow {
  id: string
  contact_id: string
  draft_body: string
  edit_distance: number | null
  rejection_reason: string | null
  guardrail_violation: string | null
  state: DraftStateCol
  generated_at: string
  resolved_at: string | null
  contact: { first_name: string | null; last_name: string | null } | null
  sent: { body: string | null } | null
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

  const url = new URL(req.url)
  const parsed = QuerySchema.safeParse({
    state: url.searchParams.get('state') ?? undefined,
    page: url.searchParams.get('page') ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }
  const { state: filter, page } = parsed.data

  const orgId = profile.organization_id
  const from = page * PAGE_SIZE
  const to = from + PAGE_SIZE - 1

  // Foreign-table join uses PostgREST embed syntax. Naming the
  // messages embed 'sent' picks up the sent_message_id FK explicitly
  // (the table has multiple FKs back to messages — trigger and sent —
  // so we hint with !sent_message_id).
  let query = supabase
    .from('ai_drafts')
    .select(
      `id, contact_id, draft_body, edit_distance, rejection_reason,
       guardrail_violation, state, generated_at, resolved_at,
       contact:contacts!contact_id(first_name, last_name),
       sent:messages!sent_message_id(body)`,
      { count: 'exact' },
    )
    .eq('organization_id', orgId)
    .order('generated_at', { ascending: false })
    .range(from, to)

  if (filter !== 'all') {
    const stateValue: DraftStateCol = filter === 'blocked' ? 'guardrail_failed' : filter
    query = query.eq('state', stateValue)
  }

  const { data, error, count } = await query
  if (error) {
    console.error('[ai-drafts/list] query error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // PostgREST returns the embedded relationship as an object (single
  // FK match) but its types sometimes widen to array. Normalize.
  const rows: DraftRow[] = ((data ?? []) as unknown as JoinedRow[]).map(r => ({
    id: r.id,
    contact_id: r.contact_id,
    contact_first_name: r.contact?.first_name ?? null,
    contact_last_name: r.contact?.last_name ?? null,
    draft_body: r.draft_body,
    sent_message_body: r.sent?.body ?? null,
    edit_distance: r.edit_distance,
    rejection_reason: r.rejection_reason,
    guardrail_violation: r.guardrail_violation,
    state: r.state,
    generated_at: r.generated_at,
    resolved_at: r.resolved_at,
  }))

  const response: DraftListResponse = {
    rows,
    total: count ?? 0,
    page,
    page_size: PAGE_SIZE,
  }
  return NextResponse.json(response)
}
