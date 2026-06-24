/**
 * GET /api/dashboard/ai-twin-briefing — Phase 2 W10.
 *
 * 24h narrative digest for the AI Twin. Powers the
 * /ai-twin/briefing page and the morning AiTwinTile's "Last 24h"
 * sub-row.
 *
 * Reads (no writes): ai_drafts, messages (direction='inbound'),
 * contacts (name join for pending preview). All queries are org-
 * scoped via the explicit organization_id filter alongside RLS.
 *
 * 60s in-memory route cache per org — both the dashboard tile and
 * the dedicated page fetch this endpoint, so absorbing the second-
 * by-second burst matters more here than freshness.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireCapability } from '@/lib/billing/require-tier'
import { cached } from '@/lib/route-cache'
import {
  computeBriefing,
  SAFETY_SCAN_INBOUND_CAP,
  type BriefingDraftRow,
  type BriefingDraftState,
  type BriefingInboundRow,
  type BriefingPayload,
  type BriefingPriorRow,
} from '@/lib/ai-twin-briefing'
import { type VoiceExampleClass } from '@/lib/voice-profile'

const BRIEFING_CACHE_TTL_MS = 60_000

// ── Raw Supabase row shapes ──────────────────────────────────────
// Kept inline rather than imported from a generated types file (we
// don't have one for ai_drafts).

interface RawDraftRow {
  id: string
  state: BriefingDraftState
  draft_body: string
  edit_distance: number | null
  guardrail_violation: string | null
  generated_at: string
  contact_id: string | null
  trigger_message_id: string | null
  context_snapshot: Record<string, unknown> | null
}

interface RawPriorRow {
  state: BriefingDraftState
  draft_body: string
  edit_distance: number | null
}

interface RawInboundRow {
  id: string
  body: string | null
  created_at: string
  contact_id: string | null
}

interface RawContactRow {
  id: string
  first_name: string | null
  last_name: string | null
}

interface RawMessageRow {
  id: string
  body: string | null
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

  const gate = await requireCapability(supabase, profile.organization_id, 'allowsAutonomousSend')
  if (!gate.ok) return gate.response

  const orgId = profile.organization_id

  const cacheKey = `ai-twin-briefing:${orgId}`
  const payload = await cached<BriefingPayload>(cacheKey, BRIEFING_CACHE_TTL_MS, () =>
    build(supabase, orgId),
  )
  return NextResponse.json(payload)
}

async function build(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
): Promise<BriefingPayload> {
  const now = new Date()
  const windowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const priorStart  = new Date(now.getTime() - 48 * 60 * 60 * 1000)
  const startIso    = windowStart.toISOString()
  const priorStartIso = priorStart.toISOString()

  // Three parallel queries — current drafts, prior drafts (delta only),
  // and inbound messages for the safety scan.
  const [currRes, priorRes, inboundRes] = await Promise.all([
    supabase
      .from('ai_drafts')
      .select('id, state, draft_body, edit_distance, guardrail_violation, generated_at, contact_id, trigger_message_id, context_snapshot')
      .eq('organization_id', orgId)
      .gte('generated_at', startIso),
    supabase
      .from('ai_drafts')
      .select('state, draft_body, edit_distance')
      .eq('organization_id', orgId)
      .gte('generated_at', priorStartIso)
      .lt('generated_at', startIso),
    supabase
      .from('messages')
      .select('id, body, created_at, contact_id')
      .eq('organization_id', orgId)
      .eq('direction', 'inbound')
      .gte('created_at', startIso)
      .order('created_at', { ascending: false })
      .limit(SAFETY_SCAN_INBOUND_CAP + 1),
  ])

  if (currRes.error)    console.error('[ai-twin-briefing] current draft query:', currRes.error.message)
  if (priorRes.error)   console.error('[ai-twin-briefing] prior draft query:',   priorRes.error.message)
  if (inboundRes.error) console.error('[ai-twin-briefing] inbound query:',        inboundRes.error.message)

  const currentRaw = (currRes.data ?? []) as RawDraftRow[]
  const priorRaw   = (priorRes.data ?? []) as RawPriorRow[]
  const inboundRaw = (inboundRes.data ?? []) as RawInboundRow[]

  // Truncation: we asked for CAP+1 to detect overflow. Trim to CAP for
  // the safety scan and surface the flag in the response.
  const inboundTruncated = inboundRaw.length > SAFETY_SCAN_INBOUND_CAP
  const inboundForScan = inboundTruncated
    ? inboundRaw.slice(0, SAFETY_SCAN_INBOUND_CAP)
    : inboundRaw

  // ── Hydrate contact names + inbound bodies for pending rows ────
  // Only the pending top-3 needs these joins. Doing them up front for
  // every pending row keeps the aggregator pure (no DB-touch fallback
  // inside computeBriefing).
  const pendingRows = currentRaw.filter(r => r.state === 'pending')
  const contactIds = Array.from(new Set(pendingRows.map(r => r.contact_id).filter((x): x is string => !!x)))
  const triggerIds = Array.from(new Set(pendingRows.map(r => r.trigger_message_id).filter((x): x is string => !!x)))

  const [contactsRes, triggerMsgsRes] = await Promise.all([
    contactIds.length > 0
      ? supabase
          .from('contacts')
          .select('id, first_name, last_name')
          .eq('organization_id', orgId)
          .in('id', contactIds)
      : Promise.resolve({ data: [] as RawContactRow[], error: null }),
    triggerIds.length > 0
      ? supabase
          .from('messages')
          .select('id, body')
          .eq('organization_id', orgId)
          .in('id', triggerIds)
      : Promise.resolve({ data: [] as RawMessageRow[], error: null }),
  ])

  const contactById = new Map<string, RawContactRow>()
  for (const c of (contactsRes.data ?? []) as RawContactRow[]) contactById.set(c.id, c)
  const triggerById = new Map<string, RawMessageRow>()
  for (const m of (triggerMsgsRes.data ?? []) as RawMessageRow[]) triggerById.set(m.id, m)

  // ── Map raw rows to aggregator shape ──────────────────────────
  const rows: BriefingDraftRow[] = currentRaw.map(r => {
    const snap = (r.context_snapshot && typeof r.context_snapshot === 'object' && !Array.isArray(r.context_snapshot))
      ? (r.context_snapshot as Record<string, unknown>)
      : {}
    const cc = snap['classified_class']
    const classified_class =
      typeof cc === 'string' && (cc === 'unknown' || isVoiceClass(cc))
        ? (cc as VoiceExampleClass | 'unknown')
        : null

    // W12 — shadow-simulated rows live in state='pending' but the
    // human is not expected to act on them.
    const shadow_simulated = snap['shadow_simulated'] === true

    let contact_name: string | null = null
    if (r.state === 'pending' && !shadow_simulated && r.contact_id) {
      const c = contactById.get(r.contact_id)
      if (c) {
        const name = `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim()
        contact_name = name || null
      }
    }

    const inbound_body =
      r.state === 'pending' && !shadow_simulated && r.trigger_message_id
        ? triggerById.get(r.trigger_message_id)?.body ?? null
        : null

    return {
      id: r.id,
      state: r.state,
      draft_body: r.draft_body ?? '',
      edit_distance: r.edit_distance,
      guardrail_violation: r.guardrail_violation,
      generated_at: r.generated_at,
      contact_id: r.contact_id,
      classified_class,
      contact_name,
      inbound_body,
      shadow_simulated,
    }
  })

  const priorRows: BriefingPriorRow[] = priorRaw.map(r => ({
    state: r.state,
    draft_body: r.draft_body ?? '',
    edit_distance: r.edit_distance,
  }))

  const inboundRows: BriefingInboundRow[] = inboundForScan.map(r => ({
    id: r.id,
    body: r.body ?? '',
    created_at: r.created_at,
    contact_id: r.contact_id,
  }))

  return computeBriefing({
    rows,
    inboundRows,
    priorRows,
    windowStart,
    windowEnd: now,
    inboundTruncated,
  })
}

const VOICE_CLASSES: ReadonlyArray<VoiceExampleClass> = [
  'greeting', 'faq', 'follow_up', 'consult_confirm', 'follow_up_cold', 'custom',
]
function isVoiceClass(s: string): s is VoiceExampleClass {
  return (VOICE_CLASSES as ReadonlyArray<string>).includes(s)
}
