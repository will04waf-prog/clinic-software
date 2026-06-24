import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { cached } from '@/lib/route-cache'
import {
  computeVoiceHealth,
  HEALTH_WINDOW_DAYS,
  type ExampleCountByClass,
  type HealthDraftRow,
  type VoiceHealth,
} from '@/lib/voice-health'
import {
  readVoiceProfile,
  VOICE_EXAMPLE_CLASSES,
  type VoiceExampleClass,
} from '@/lib/voice-profile'

/**
 * GET /api/org/voice-health — Phase 2 W8.
 *
 * Aggregates the calling org's ai_drafts over the last
 * HEALTH_WINDOW_DAYS days, joins with voice_examples counts and the
 * stored voice profile, and returns per-class metrics +
 * recommendations.
 *
 * Cached 15s — short enough that voice-profile / example edits show
 * up almost immediately, long enough to absorb a poll burst.
 */

const CACHE_TTL_MS = 15_000
/**
 * Hard cap on draft rows pulled per window. Supabase enforces a row
 * cap on PostgREST queries (~1000 default); a deterministic order +
 * explicit limit avoids silent truncation that would otherwise make
 * the aggregator's output depend on row ordering quirks.
 */
const MAX_DRAFTS_FETCHED = 2000

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

  const payload = await cached<VoiceHealth>(`voice-health:${orgId}`, CACHE_TTL_MS, () =>
    build(supabase, orgId),
  )
  return NextResponse.json(payload)
}

async function build(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
): Promise<VoiceHealth> {
  const windowStart = new Date(Date.now() - HEALTH_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  const windowStartIso = windowStart.toISOString()

  // Three parallel reads: drafts in window, example counts, voice profile.
  // ai_drafts is org-isolated via RLS but we also pin organization_id for
  // belt-and-braces. context_snapshot is fetched whole — supabase-js TS
  // inference doesn't support `->>` jsonb projections cleanly, and the
  // payload size is acceptable at the row cap.
  const [draftsRes, examplesRes, orgRes] = await Promise.all([
    supabase
      .from('ai_drafts')
      .select('id, state, draft_body, edit_distance, guardrail_violation, generated_at, context_snapshot')
      .eq('organization_id', orgId)
      .gte('generated_at', windowStartIso)
      .order('generated_at', { ascending: false })
      .limit(MAX_DRAFTS_FETCHED),
    supabase
      .from('voice_examples')
      .select('class')
      .eq('organization_id', orgId),
    supabase
      .from('organizations')
      .select('ai_twin_voice_profile')
      .eq('id', orgId)
      .single(),
  ])

  const rawDrafts = (draftsRes.data ?? []) as Array<{
    id: string
    state: string | null
    draft_body: string | null
    edit_distance: number | null
    guardrail_violation: string | null
    generated_at: string
    context_snapshot: unknown
  }>

  const rows: HealthDraftRow[] = rawDrafts.map(r => {
    // Narrow context_snapshot to a plain object before reading keys.
    // jsonb can be null, primitive, array, or object — only object-shaped
    // payloads have the voice_* fields we care about.
    const snap =
      r.context_snapshot &&
      typeof r.context_snapshot === 'object' &&
      !Array.isArray(r.context_snapshot)
        ? (r.context_snapshot as Record<string, unknown>)
        : {}

    const rawClass = snap.voice_class
    const voice_class: VoiceExampleClass | null =
      typeof rawClass === 'string' && (VOICE_EXAMPLE_CLASSES as readonly string[]).includes(rawClass)
        ? (rawClass as VoiceExampleClass)
        : null
    const rawUsed = snap.voice_examples_used
    const voice_examples_used = typeof rawUsed === 'number' && Number.isFinite(rawUsed) ? rawUsed : null

    return {
      id: r.id,
      state: (r.state ?? 'pending') as HealthDraftRow['state'],
      draft_body: r.draft_body ?? '',
      edit_distance: r.edit_distance,
      guardrail_violation: r.guardrail_violation,
      generated_at: r.generated_at,
      voice_class,
      voice_examples_used,
    }
  })

  const examplesByClass: ExampleCountByClass = {
    greeting:        0,
    faq:             0,
    follow_up:       0,
    consult_confirm: 0,
    follow_up_cold:  0,
    custom:          0,
  }
  for (const e of (examplesRes.data ?? []) as Array<{ class: string }>) {
    if ((VOICE_EXAMPLE_CLASSES as readonly string[]).includes(e.class)) {
      examplesByClass[e.class as VoiceExampleClass] += 1
    }
  }

  const voiceProfile = readVoiceProfile(orgRes.data?.ai_twin_voice_profile ?? {})

  return computeVoiceHealth(rows, examplesByClass, voiceProfile, windowStart)
}
