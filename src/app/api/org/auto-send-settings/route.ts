import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { requireCapability } from '@/lib/billing/require-tier'
import { requireRole, isDenied, OWNER_ADMIN } from '@/lib/auth/roles'
import {
  checkAutoSendEligibility,
  AUTO_SEND_BANNED_PHRASE_LOOKBACK_DAYS,
  type EligibilityResult,
} from '@/lib/auto-send-eligibility'
import {
  computeVoiceHealth,
  HEALTH_WINDOW_DAYS,
  type ExampleCountByClass,
  type HealthDraftRow,
} from '@/lib/voice-health'
import {
  readVoiceProfile,
  VOICE_EXAMPLE_CLASSES,
  type VoiceExampleClass,
} from '@/lib/voice-profile'

/**
 * GET   /api/org/auto-send-settings — returns current master toggle,
 *       per-class allowlist, per-class eligibility (with reasons),
 *       and the last 5 auto-sent drafts (for the audit panel).
 *
 * PATCH /api/org/auto-send-settings — update enabled + classes.
 *       Restricted to owner/admin roles — flipping autonomous mode
 *       is a security-relevant action that goes to patients without
 *       further review.
 *
 * Phase 2 W9. The eligibility check here is identical to the one
 * autoDraftForInbound runs at send time — so what the user sees in
 * Settings matches what actually happens on the next inbound.
 */

// Only classes the inbound classifier can actually return. Showing
// other classes in the UI would let an owner check a box that does
// nothing — autoDraftForInbound's classifier never produces them
// for inbound messages.
const INBOUND_ELIGIBLE_CLASSES = ['greeting', 'faq', 'consult_confirm'] as const
type InboundEligibleClass = typeof INBOUND_ELIGIBLE_CLASSES[number]

const PatchSchema = z.object({
  enabled: z.boolean().optional(),
  classes: z.array(z.enum(INBOUND_ELIGIBLE_CLASSES)).optional(),
  rollout_pct: z.number().int().min(0).max(100)
    .refine(n => n % 10 === 0, 'rollout_pct must be a multiple of 10')
    .optional(),
  shadow_mode: z.boolean().optional(),
})

interface PerClassStatus {
  class: VoiceExampleClass
  enabled_by_owner: boolean
  eligibility: EligibilityResult
  /** Class metrics surfaced for the UI to render the trust thresholds. */
  drafts_resolved: number
  ratio_sample_size: number
  avg_edit_ratio: number | null
  examples_saved: number
}

interface RecentAutoSend {
  id: string
  generated_at: string
  resolved_at: string | null
  draft_body_preview: string
  message_class: string | null
}

interface AutoSendSettingsResponse {
  enabled: boolean
  classes: VoiceExampleClass[]
  per_class: PerClassStatus[]
  recent_auto_sends: RecentAutoSend[]
  recent_banned_phrase_hits: number
  recent_banned_phrase_lookback_days: number
  /** W12: 0..100 in 10-step increments. Default 100 = W9 behavior. */
  rollout_pct: number
  /** W12: when true, eligibility runs but Twilio never fires. */
  shadow_mode: boolean
  /** W12: count of activity_log shadow rows in the last 24h. */
  shadow_simulations_24h: number
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

  const windowStart = new Date(Date.now() - HEALTH_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  const bannedLookback = new Date(Date.now() - AUTO_SEND_BANNED_PHRASE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const shadow24hStart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const [orgRes, draftsRes, examplesRes, recentAutoSentsRes, bannedHitsRes, shadow24hRes] = await Promise.all([
    supabase
      .from('organizations')
      .select('ai_twin_auto_send_enabled, ai_twin_auto_send_classes, ai_twin_voice_profile, ai_twin_auto_send_rollout_pct, ai_twin_auto_send_shadow_mode')
      .eq('id', orgId)
      .single(),
    supabase
      .from('ai_drafts')
      .select('id, state, draft_body, edit_distance, guardrail_violation, generated_at, context_snapshot')
      .eq('organization_id', orgId)
      .gte('generated_at', windowStart.toISOString())
      .order('generated_at', { ascending: false })
      .limit(2000),
    supabase
      .from('voice_examples')
      .select('class')
      .eq('organization_id', orgId),
    supabase
      .from('ai_drafts')
      .select('id, generated_at, resolved_at, draft_body, context_snapshot')
      .eq('organization_id', orgId)
      .eq('state', 'auto_sent')
      .order('generated_at', { ascending: false })
      .limit(5),
    supabase
      .from('ai_drafts')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('guardrail_violation', 'banned_phrase')
      .gte('generated_at', bannedLookback),
    supabase
      .from('activity_log')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('action', 'ai_twin_auto_send_shadow_simulated')
      .gte('created_at', shadow24hStart),
  ])

  const enabled = orgRes.data?.ai_twin_auto_send_enabled === true
  const allowlist = ((orgRes.data?.ai_twin_auto_send_classes as string[] | null) ?? [])
    .filter((c): c is VoiceExampleClass => (VOICE_EXAMPLE_CLASSES as readonly string[]).includes(c))
  // W12 — defaults preserve W9 behavior when the migration hasn't
  // run yet (?? 100, ?? false) so the deploy is order-tolerant.
  const rolloutPct =
    typeof (orgRes.data as { ai_twin_auto_send_rollout_pct?: number | null } | null)?.ai_twin_auto_send_rollout_pct === 'number'
      ? ((orgRes.data as { ai_twin_auto_send_rollout_pct: number }).ai_twin_auto_send_rollout_pct)
      : 100
  const shadowMode =
    (orgRes.data as { ai_twin_auto_send_shadow_mode?: boolean | null } | null)?.ai_twin_auto_send_shadow_mode === true

  // ── Build per-class metrics for the eligibility check. ──
  const rows: HealthDraftRow[] = ((draftsRes.data ?? []) as Array<{
    id: string
    state: string | null
    draft_body: string | null
    edit_distance: number | null
    guardrail_violation: string | null
    generated_at: string
    context_snapshot: unknown
  }>).map(r => {
    const snap =
      r.context_snapshot && typeof r.context_snapshot === 'object' && !Array.isArray(r.context_snapshot)
        ? (r.context_snapshot as Record<string, unknown>)
        : {}
    const rawClass = snap.voice_class
    const vc: VoiceExampleClass | null =
      typeof rawClass === 'string' && (VOICE_EXAMPLE_CLASSES as readonly string[]).includes(rawClass)
        ? (rawClass as VoiceExampleClass)
        : null
    const rawUsed = snap.voice_examples_used
    return {
      id: r.id,
      state: (r.state ?? 'pending') as HealthDraftRow['state'],
      draft_body: r.draft_body ?? '',
      edit_distance: r.edit_distance,
      guardrail_violation: r.guardrail_violation,
      generated_at: r.generated_at,
      voice_class: vc,
      voice_examples_used: typeof rawUsed === 'number' && Number.isFinite(rawUsed) ? rawUsed : null,
    }
  })

  const examplesByClass: ExampleCountByClass = {
    greeting: 0, faq: 0, follow_up: 0, consult_confirm: 0, follow_up_cold: 0, custom: 0,
  }
  for (const e of (examplesRes.data ?? []) as Array<{ class: string }>) {
    if ((VOICE_EXAMPLE_CLASSES as readonly string[]).includes(e.class)) {
      examplesByClass[e.class as VoiceExampleClass] += 1
    }
  }

  const voiceProfile = readVoiceProfile(orgRes.data?.ai_twin_voice_profile ?? {})
  const health = computeVoiceHealth(rows, examplesByClass, voiceProfile, windowStart)
  const recentBannedHits = bannedHitsRes.count ?? 0

  // ── For each inbound-classifier-eligible class, run the same
  // eligibility check the live path runs. We feed favorable inputs
  // for the per-message gates (safety trigger, quiet hours, consent)
  // so the UI's "eligible" verdict reflects "this org+class qualifies
  // in principle." Per-message gates still apply at send time.
  //
  // Only inbound-eligible classes are surfaced — follow_up,
  // follow_up_cold, and custom can never be auto-sent on inbound
  // (classifyInbound never returns them) so showing checkboxes for
  // them would be misleading.
  const perClass: PerClassStatus[] = INBOUND_ELIGIBLE_CLASSES.map(cls => {
    const cm = health.per_class.find(c => c.class === cls) ?? null
    const eligibility = checkAutoSendEligibility({
      orgMasterEnabled: enabled,
      orgAllowlist: allowlist,
      messageClass: cls,
      safetyTriggerLabel: null,
      isInQuietHours: false,
      hasSmsConsent: true,
      contactOptedOut: false,
      classMetrics: cm,
      recentBannedPhraseHits: recentBannedHits,
      // PROBE check — feed favorable rollout/shadow inputs because
      // the per-contact bucket only makes sense at send time and
      // shadow mode is a runtime decision, not an "in principle"
      // eligibility blocker.
      rolloutPct: 100,
      shadowMode: false,
    })
    return {
      class: cls,
      enabled_by_owner: allowlist.includes(cls),
      eligibility,
      drafts_resolved: cm?.drafts_resolved ?? 0,
      ratio_sample_size: cm?.ratio_sample_size ?? 0,
      avg_edit_ratio: cm?.avg_edit_ratio ?? null,
      examples_saved: cm?.examples_saved ?? 0,
    }
  })

  const recent_auto_sends: RecentAutoSend[] = ((recentAutoSentsRes.data ?? []) as Array<{
    id: string
    generated_at: string
    resolved_at: string | null
    draft_body: string | null
    context_snapshot: unknown
  }>).map(r => {
    const snap =
      r.context_snapshot && typeof r.context_snapshot === 'object' && !Array.isArray(r.context_snapshot)
        ? (r.context_snapshot as Record<string, unknown>)
        : {}
    const mc = typeof snap.voice_class === 'string' ? snap.voice_class : null
    return {
      id: r.id,
      generated_at: r.generated_at,
      resolved_at: r.resolved_at,
      draft_body_preview: (r.draft_body ?? '').slice(0, 140),
      message_class: mc,
    }
  })

  const payload: AutoSendSettingsResponse = {
    enabled,
    classes: allowlist,
    per_class: perClass,
    recent_auto_sends,
    recent_banned_phrase_hits: recentBannedHits,
    recent_banned_phrase_lookback_days: AUTO_SEND_BANNED_PHRASE_LOOKBACK_DAYS,
    rollout_pct: rolloutPct,
    shadow_mode: shadowMode,
    shadow_simulations_24h: shadow24hRes.count ?? 0,
  }
  return NextResponse.json(payload)
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Autonomous send goes to patients without further human review —
  // restrict toggle changes to admin-class roles.
  const roleGate = await requireRole(supabase, user.id, OWNER_ADMIN)
  if (isDenied(roleGate)) return roleGate.response
  const orgId = roleGate.orgId

  const capGate = await requireCapability(supabase, orgId, 'allowsAutonomousSend')
  if (!capGate.ok) return capGate.response

  let rawBody: unknown
  try { rawBody = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const parsed = PatchSchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const update: Record<string, unknown> = {}
  if (typeof parsed.data.enabled === 'boolean') {
    update.ai_twin_auto_send_enabled = parsed.data.enabled
  }
  if (Array.isArray(parsed.data.classes)) {
    update.ai_twin_auto_send_classes = Array.from(new Set(parsed.data.classes))
  }
  if (typeof parsed.data.rollout_pct === 'number') {
    update.ai_twin_auto_send_rollout_pct = parsed.data.rollout_pct
  }
  if (typeof parsed.data.shadow_mode === 'boolean') {
    update.ai_twin_auto_send_shadow_mode = parsed.data.shadow_mode
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No changes provided' }, { status: 400 })
  }

  const { error: updErr } = await supabase
    .from('organizations')
    .update(update)
    .eq('id', orgId)
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

  // Audit trail: every toggle change is an admin action.
  await supabase.from('activity_log').insert({
    organization_id: orgId,
    action: 'ai_twin_auto_send_settings_changed',
    metadata: {
      ...update,
      changed_by_user_id: user.id,
    },
  })

  return NextResponse.json({ ok: true, ...update })
}
