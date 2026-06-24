import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireCapability } from '@/lib/billing/require-tier'
import {
  AUDIT_ACTIONS,
  type AuditAction,
  type AuditPage,
  type AuditRow,
  type RawActivityLogRow,
  type RawContactRow,
  type RawDraftRow,
  formatAuditRow,
  paginationRange,
  parseAuditFilters,
} from '@/lib/ai-twin-audit'

/**
 * GET /api/ai-twin/audit
 *
 * Returns the org's AI Twin activity_log rows joined with the
 * referenced ai_drafts + contacts, filtered by the caller's query
 * params. RLS is enforced via the user-scoped supabase client; no
 * service role.
 *
 * The route stays a thin wrapper: filter parsing + DB fetch + a hand
 * off to formatAuditRow (pure, lives in ai-twin-audit.ts).
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const supabase = await createClient()

  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single()
  if (!profile?.organization_id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const orgId = profile.organization_id as string

  const gate = await requireCapability(supabase, orgId, 'allowsVoiceTraining')
  if (!gate.ok) return gate.response

  const url = new URL(req.url)
  const parsed = parseAuditFilters(url.searchParams)
  if (!parsed.ok) {
    return NextResponse.json({ error: 'invalid_filters', details: parsed.errors }, { status: 400 })
  }
  const filters = parsed.filters

  const actions: AuditAction[] = filters.actions ?? Array.from(AUDIT_ACTIONS)

  const { from: rangeFrom, to: rangeTo } = paginationRange(filters.page, filters.page_size)

  // ── 1. Pull activity_log rows (org-scoped, action-filtered). ──
  let logQuery = supabase
    .from('activity_log')
    .select('id, organization_id, contact_id, action, metadata, created_at', { count: 'exact' })
    .eq('organization_id', orgId)
    .in('action', actions as unknown as string[])
    .order('created_at', { ascending: false })

  if (filters.from) logQuery = logQuery.gte('created_at', filters.from)
  if (filters.to)   logQuery = logQuery.lte('created_at', filters.to)
  if (filters.contact_id) logQuery = logQuery.eq('contact_id', filters.contact_id)

  // Apply pagination after filters so total reflects the filter set.
  const { data: logRowsRaw, count, error: logErr } = await logQuery.range(rangeFrom, rangeTo)
  if (logErr) {
    console.error('[ai-twin/audit] activity_log query failed:', logErr.message)
    return NextResponse.json({ error: 'query_failed' }, { status: 500 })
  }
  const logRows = (logRowsRaw ?? []) as RawActivityLogRow[]

  // ── 2. Batch-fetch referenced ai_drafts. ──
  const draftIds = new Set<string>()
  for (const r of logRows) {
    const md = r.metadata ?? {}
    const did = md['draft_id']
    if (typeof did === 'string' && did.length > 0) draftIds.add(did)
  }

  let draftsById = new Map<string, RawDraftRow>()
  if (draftIds.size > 0) {
    const { data: drafts, error: dErr } = await supabase
      .from('ai_drafts')
      .select('id, state, draft_body, edit_distance, guardrail_violation, context_snapshot')
      .in('id', Array.from(draftIds))
    if (dErr) {
      console.error('[ai-twin/audit] ai_drafts query failed:', dErr.message)
      return NextResponse.json({ error: 'query_failed' }, { status: 500 })
    }
    draftsById = new Map((drafts ?? []).map(d => [d.id as string, d as unknown as RawDraftRow]))
  }

  // ── 3. Apply message_class filter (post-fetch, since the
  //      class lives inside context_snapshot or metadata). ──
  let visibleLogRows = logRows
  if (filters.message_class) {
    visibleLogRows = logRows.filter(r => {
      const md = r.metadata ?? {}
      const did = typeof md['draft_id'] === 'string' ? (md['draft_id'] as string) : null
      const draft = did ? draftsById.get(did) : null
      const cs = draft?.context_snapshot ?? {}
      const cls =
        (typeof cs['voice_class'] === 'string' ? cs['voice_class'] : null) ??
        (typeof cs['classified_class'] === 'string' ? cs['classified_class'] : null) ??
        (typeof md['message_class'] === 'string' ? (md['message_class'] as string) : null)
      return cls === filters.message_class
    })
  }

  // ── 4. Batch-fetch contacts referenced by the visible rows. ──
  const contactIds = new Set<string>()
  for (const r of visibleLogRows) {
    if (r.contact_id) contactIds.add(r.contact_id)
    const md = r.metadata ?? {}
    const mcid = md['contact_id']
    if (typeof mcid === 'string' && mcid.length > 0) contactIds.add(mcid)
  }

  let contactsById = new Map<string, RawContactRow>()
  if (contactIds.size > 0) {
    const { data: contacts, error: cErr } = await supabase
      .from('contacts')
      .select('id, first_name, last_name')
      .in('id', Array.from(contactIds))
    if (cErr) {
      console.error('[ai-twin/audit] contacts query failed:', cErr.message)
      return NextResponse.json({ error: 'query_failed' }, { status: 500 })
    }
    contactsById = new Map(
      (contacts ?? []).map(c => [c.id as string, c as unknown as RawContactRow]),
    )
  }

  // ── 5. Resolve which drafts the *current user* has already flagged. ──
  const flaggedByMe = new Set<string>()
  if (draftIds.size > 0) {
    const { data: flagRows } = await supabase
      .from('activity_log')
      .select('metadata')
      .eq('organization_id', orgId)
      .eq('action', 'ai_twin_auto_sent_flagged')
      .in('metadata->>draft_id', Array.from(draftIds))
    for (const r of flagRows ?? []) {
      const md = (r.metadata ?? {}) as Record<string, unknown>
      const did = md['draft_id']
      const flaggedBy = md['flagged_by_user_id']
      if (typeof did === 'string' && flaggedBy === user.id) {
        flaggedByMe.add(did)
      }
    }
  }

  // ── 6. Shape rows + apply safety_only filter. ──
  const shaped: AuditRow[] = []
  for (const r of visibleLogRows) {
    const out = formatAuditRow(r, draftsById, contactsById, flaggedByMe)
    if (!out) continue
    if (filters.safety_only && out.safety_incident_kind === null) continue
    shaped.push(out)
  }

  // ── 7. Total semantics ─────────────────────────────────────────
  // When we apply post-fetch filters (message_class, safety_only),
  // the `count` from Supabase doesn't reflect them. In that case
  // expose the shaped length so the UI's pagination footer stays
  // honest. The trade-off: when those filters are active, pagination
  // is "page within the underlying action set" rather than "page
  // across filtered rows" — a future iteration could push the
  // class filter into the DB by indexing on context_snapshot.
  const filterAppliedPostFetch = !!filters.message_class || filters.safety_only
  const total = filterAppliedPostFetch ? shaped.length : (count ?? shaped.length)

  const body: AuditPage = {
    rows: shaped,
    total,
    page: filters.page,
    page_size: filters.page_size,
  }
  return NextResponse.json(body)
}
