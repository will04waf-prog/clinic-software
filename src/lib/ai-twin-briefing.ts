/**
 * AI Twin Provider Briefing — Phase 2 W10.
 *
 * Pure aggregator. Computes a narrative 24h digest of what the AI Twin
 * did: actions taken, drafts awaiting review, safety triggers grouped
 * by category, voice-health delta, and per-class auto-send counts.
 *
 * Read-only — no Supabase access. The route at
 * /api/dashboard/ai-twin-briefing fetches rows and calls computeBriefing.
 *
 * Distinct from voice-health.ts:
 *   - 24h rolling window (not 30d)
 *   - 24h vs prior 24h delta (not "with vs without exemplars")
 *   - groups inbound safety triggers by category (W9 inbound-classifier)
 *
 * Pattern mirrors voice-health.ts: a separate route does I/O, this file
 * stays a pure data function so the bucket math is unit-testable.
 */

import { safetyTrigger } from '@/lib/inbound-classifier'
import {
  type VoiceExampleClass,
  VOICE_CLASS_LABEL,
} from '@/lib/voice-profile'

// ─── Tunables ──────────────────────────────────────────────────────

/** Rolling window size for the briefing. */
export const BRIEFING_WINDOW_HOURS = 24

/**
 * Minimum number of edited drafts on each side of the delta before we
 * emit a directional voice-health signal. Below this we explicitly
 * report 'insufficient_sample'.
 */
export const MIN_VOICE_DELTA_SAMPLE = 3

/**
 * Truncation cap for the inbound safety-scan. High-volume clinics could
 * have hundreds of inbounds in 24h — capping protects the aggregator
 * from runaway cost. UI surfaces a 'truncated' flag when we hit it.
 */
export const SAFETY_SCAN_INBOUND_CAP = 500

/** Max examples per category surfaced in the briefing. */
export const SAFETY_EXAMPLES_PER_CATEGORY = 2

/** Max length for any inbound preview surfaced in the UI. */
export const PREVIEW_MAX_CHARS = 120

/** Max pending drafts surfaced in 'pending_top'. */
export const PENDING_TOP_LIMIT = 3

// ─── Safety category mapping ───────────────────────────────────────
//
// Mirrors inbound-classifier's SAFETY_RULES categories. We re-derive
// category from the matched LABEL here because safetyTrigger() returns
// the label only (string), not the category. If W9 ever exports the
// category union directly we can drop this duplication.
//
// TODO(w10): export SafetyCategory + label→category map from
// inbound-classifier so this lookup is single-sourced.

export type SafetyCategory =
  | 'medical'
  | 'contraindication'
  | 'pregnancy'
  | 'minor'
  | 'self_harm'
  | 'cognitive'
  | 'cancel'
  | 'complaint'
  | 'privacy'
  | 'legal'
  | 'urgency'
  | 'financial'
  | 'escalation'
  | 'empty_body'

/**
 * Lookup matched-label → category. Kept in sync with SAFETY_RULES in
 * inbound-classifier.ts. A missing label falls back to 'medical' (the
 * largest bucket and the safest place to land an unknown safety hit).
 */
const LABEL_TO_CATEGORY: Record<string, SafetyCategory> = {
  // self_harm
  'self-harm': 'self_harm',
  'suicidal': 'self_harm',
  'end my life': 'self_harm',
  'hurt myself': 'self_harm',
  'want to die': 'self_harm',
  'overdose': 'self_harm',

  // minor
  'minor reference': 'minor',
  'age under 18': 'minor',
  'minor': 'minor',
  'under 18': 'minor',
  'underage': 'minor',

  // pregnancy
  'pregnant': 'pregnancy',
  'breastfeeding': 'pregnancy',
  'nursing': 'pregnancy',
  'trying to conceive': 'pregnancy',
  'ttc': 'pregnancy',
  'ivf': 'pregnancy',
  'expecting': 'pregnancy',

  // contraindication
  'diabetes': 'contraindication',
  'blood thinner': 'contraindication',
  'anticoagulant': 'contraindication',
  'accutane': 'contraindication',
  'autoimmune': 'contraindication',
  'lupus': 'contraindication',
  'pacemaker': 'contraindication',
  'cancer': 'contraindication',
  'immunocompromised': 'contraindication',

  // medical
  'reaction': 'medical',
  'allergic': 'medical',
  'swelling': 'medical',
  'bruising': 'medical',
  'pain': 'medical',
  'hurts': 'medical',
  'bleeding': 'medical',
  'infection': 'medical',
  'emergency': 'medical',
  'doctor': 'medical',
  'sick': 'medical',
  'numbness': 'medical',
  'rash': 'medical',
  'dizzy': 'medical',
  'lump': 'medical',
  'scab': 'medical',
  'peeling': 'medical',
  'itchy': 'medical',
  'burning': 'medical',
  'side effect': 'medical',
  "can't breathe": 'medical',
  'chest pain': 'medical',

  // complaint
  'complaint': 'complaint',
  'unhappy': 'complaint',
  'disappointed': 'complaint',
  'angry': 'complaint',
  'upset': 'complaint',
  'worst': 'complaint',
  'terrible': 'complaint',
  'hate': 'complaint',
  'not happy': 'complaint',
  "didn't work": 'complaint',
  'not coming back': 'complaint',
  'rude': 'complaint',
  'unprofessional': 'complaint',
  'failed': 'complaint',
  'no results': 'complaint',
  'wore off': 'complaint',
  "isn't working": 'complaint',
  'made it worse': 'complaint',
  'looks weird': 'complaint',
  "doesn't look right": 'complaint',
  'uneven': 'complaint',

  // cancel
  'cancel': 'cancel',
  'refund': 'cancel',
  'money back': 'cancel',
  "can't make it": 'cancel',
  'not coming': 'cancel',
  'reschedule': 'cancel',
  'push back': 'cancel',
  'move appt': 'cancel',

  // privacy
  'call me': 'privacy',
  'private': 'privacy',
  'confidential': 'privacy',
  'sensitive': 'privacy',

  // cognitive
  "don't remember": 'cognitive',
  'who is this': 'cognitive',
  'what was that': 'cognitive',

  // legal
  'lawyer': 'legal',
  'attorney': 'legal',
  'sue': 'legal',
  'lawsuit': 'legal',
  'court': 'legal',

  // escalation
  'BBB': 'escalation',
  'yelp': 'escalation',
  'google review': 'escalation',
  'fraud': 'escalation',
  'reporting you': 'escalation',

  // financial
  "can't afford": 'financial',
  'lost my job': 'financial',

  // urgency
  'urgent': 'urgency',
  'asap': 'urgency',
  'immediately': 'urgency',
  'right now': 'urgency',

  // empty body sentinel
  'empty_body': 'empty_body',
}

/** Human-readable label per category for UI surfaces. */
export const SAFETY_CATEGORY_LABEL: Record<SafetyCategory, string> = {
  medical:          'Medical / adverse reaction',
  contraindication: 'Contraindication',
  pregnancy:        'Pregnancy / breastfeeding',
  minor:            'Minor reference',
  self_harm:        'Self-harm / suicide',
  cognitive:        'Confusion / who-is-this',
  cancel:           'Cancel / refund / reschedule',
  complaint:        'Complaint',
  privacy:          'Privacy / callback request',
  legal:            'Legal mention',
  urgency:          'Urgency',
  financial:        'Financial distress',
  escalation:       'Public-review threat',
  empty_body:       'Empty inbound',
}

/**
 * Severity sort order used to break ties in safety_triggers when two
 * categories have identical counts. Self-harm and medical first.
 */
const CATEGORY_SEVERITY_RANK: Record<SafetyCategory, number> = {
  self_harm:        0,
  medical:          1,
  contraindication: 2,
  pregnancy:        3,
  minor:            4,
  legal:            5,
  escalation:       6,
  complaint:        7,
  cancel:           8,
  privacy:          9,
  urgency:         10,
  financial:       11,
  cognitive:       12,
  empty_body:      13,
}

function categoryFor(label: string): SafetyCategory {
  return LABEL_TO_CATEGORY[label] ?? 'medical'
}

// ─── Row shapes ────────────────────────────────────────────────────

export type BriefingDraftState =
  | 'pending'
  | 'sent'
  | 'edited'
  | 'rejected'
  | 'expired'
  | 'guardrail_failed'
  | 'auto_sent'

/**
 * Shape of an ai_drafts row needed by the aggregator. Caller extracts
 * classified_class from context_snapshot at query time so the
 * aggregator stays a pure data function.
 */
export interface BriefingDraftRow {
  id: string
  state: BriefingDraftState
  draft_body: string
  edit_distance: number | null
  guardrail_violation: string | null
  generated_at: string
  contact_id: string | null
  /**
   * From context_snapshot->>'classified_class'. null for drafts
   * generated before W9 — those are excluded from per-class breakdowns.
   */
  classified_class: VoiceExampleClass | 'unknown' | null
  /**
   * Only relevant for state='pending'. Used to surface the awaiting-
   * review subset. null on non-pending rows.
   */
  contact_name: string | null
  /**
   * Inbound that triggered this draft, joined at query time so the
   * pending preview can show it. Trimmed/redacted by toPreview() below.
   */
  inbound_body: string | null
  /**
   * W12 — true when the row is state='pending' AND context_snapshot
   * carries shadow_simulated=true (auto-send ran shadow-mode and the
   * draft would have been sent but Twilio was bypassed). These rows
   * are NOT awaiting human action; they're a preview signal.
   */
  shadow_simulated: boolean
}

/**
 * Inbound row — direction='inbound' messages in the briefing window.
 * Used to compute safety_triggers.
 */
export interface BriefingInboundRow {
  id: string
  body: string
  created_at: string
  contact_id: string | null
}

/**
 * Prior-window row shape, narrower than BriefingDraftRow — we only
 * need state + edit_distance + body length for the voice-health delta.
 */
export interface BriefingPriorRow {
  state: BriefingDraftState
  draft_body: string
  edit_distance: number | null
}

// ─── Response shapes ──────────────────────────────────────────────

export interface BriefingActionCounts {
  auto_sent:        number
  sent_unchanged:   number
  edited:           number
  rejected:         number
  guardrail_failed: number
  /**
   * Inbounds we saw with a non-null safetyTrigger() — i.e. potential
   * auto-send candidates that we instead held for human review.
   * Source-of-truth is the inbound messages table (not ai_drafts),
   * because some safety holds never produce a draft at all.
   */
  safety_held:      number
  /** Drafts still in 'pending' state in the window — awaiting review. */
  pending_open:     number
  /**
   * W12 — count of pending rows that were shadow-simulated (would
   * have auto-sent if shadow_mode were off). These ARE in state
   * 'pending' on disk but are NOT awaiting human review; they're a
   * preview signal. pending_open excludes them.
   */
  shadow_would_have_sent: number
}

export interface BriefingPendingItem {
  id: string
  contact_name: string | null
  inbound_preview: string
  age_minutes: number
}

export interface BriefingSafetyExample {
  message_id: string
  label: string
  preview: string
}

export interface BriefingSafetyCategoryBucket {
  category: SafetyCategory
  label: string
  count: number
  examples: BriefingSafetyExample[]
}

export interface BriefingSafetyTriggers {
  total_matched_inbounds: number
  inbound_scanned: number
  truncated: boolean
  by_category: BriefingSafetyCategoryBucket[]
}

export type VoiceDeltaDirection = 'up' | 'down' | 'flat' | 'insufficient_sample'

export interface BriefingVoiceDelta {
  sample_size_current: number
  sample_size_prior: number
  avg_edit_ratio_current: number | null
  avg_edit_ratio_prior: number | null
  direction: VoiceDeltaDirection
}

export interface BriefingAutoSendClassBucket {
  class: VoiceExampleClass
  label: string
  count: number
}

export interface BriefingWindow {
  hours: number
  started_at: string
  ended_at: string
}

export interface BriefingPayload {
  window: BriefingWindow
  action_counts: BriefingActionCounts
  pending_top: BriefingPendingItem[]
  safety_triggers: BriefingSafetyTriggers
  voice_health_delta: BriefingVoiceDelta
  auto_send_by_class: BriefingAutoSendClassBucket[]
  generated_at: string
}

// ─── Aggregation ───────────────────────────────────────────────────

export interface ComputeBriefingArgs {
  rows: ReadonlyArray<BriefingDraftRow>
  inboundRows: ReadonlyArray<BriefingInboundRow>
  priorRows: ReadonlyArray<BriefingPriorRow>
  windowStart: Date
  windowEnd: Date
  /**
   * Whether the inbound scan hit the safety-scan cap. Caller decides
   * the cap at query time; aggregator just reports it back to the UI.
   */
  inboundTruncated: boolean
}

export function computeBriefing(args: ComputeBriefingArgs): BriefingPayload {
  const { rows, inboundRows, priorRows, windowStart, windowEnd, inboundTruncated } = args

  // ── Action counts ────────────────────────────────────────────────
  const action_counts: BriefingActionCounts = {
    auto_sent:        0,
    sent_unchanged:   0,
    edited:           0,
    rejected:         0,
    guardrail_failed: 0,
    safety_held:      0,
    pending_open:     0,
    shadow_would_have_sent: 0,
  }
  for (const r of rows) {
    switch (r.state) {
      case 'auto_sent':        action_counts.auto_sent        += 1; break
      case 'sent':             action_counts.sent_unchanged   += 1; break
      case 'edited':           action_counts.edited           += 1; break
      case 'rejected':         action_counts.rejected         += 1; break
      case 'guardrail_failed': action_counts.guardrail_failed += 1; break
      case 'pending':
        // Shadow-simulated pending rows are a preview signal, not
        // awaiting human action — bucket them separately so the
        // pending_open count is honest.
        if (r.shadow_simulated) action_counts.shadow_would_have_sent += 1
        else                    action_counts.pending_open           += 1
        break
      // 'expired' is intentionally excluded — no human or system
      // decision was recorded.
    }
  }

  // ── Safety triggers over inbound messages ───────────────────────
  // Re-run safetyTrigger over every inbound in the window. This is
  // separate from the auto-send refusal path (which also calls
  // safetyTrigger) because we want to surface the *kind* of risky
  // inbound, not just the count of refusals — some inbounds may not
  // have produced a draft at all (e.g. opt-out flow short-circuited).
  const triggerHits: Array<{ inbound: BriefingInboundRow; label: string; category: SafetyCategory }> = []
  for (const inb of inboundRows) {
    const label = safetyTrigger(inb.body ?? '')
    if (label === null) continue
    triggerHits.push({ inbound: inb, label, category: categoryFor(label) })
  }

  // Group by category. Map preserves insertion order; we sort below.
  const byCategoryMap = new Map<SafetyCategory, BriefingSafetyCategoryBucket>()
  for (const hit of triggerHits) {
    let bucket = byCategoryMap.get(hit.category)
    if (!bucket) {
      bucket = {
        category: hit.category,
        label: SAFETY_CATEGORY_LABEL[hit.category],
        count: 0,
        examples: [],
      }
      byCategoryMap.set(hit.category, bucket)
    }
    bucket.count += 1
    if (bucket.examples.length < SAFETY_EXAMPLES_PER_CATEGORY) {
      bucket.examples.push({
        message_id: hit.inbound.id,
        label: hit.label,
        preview: toPreview(hit.inbound.body ?? ''),
      })
    }
  }

  const by_category = Array.from(byCategoryMap.values()).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count
    return CATEGORY_SEVERITY_RANK[a.category] - CATEGORY_SEVERITY_RANK[b.category]
  })

  action_counts.safety_held = triggerHits.length

  // ── Voice-health delta (current vs prior 24h) ───────────────────
  const currentRatios = rows
    .map(r => editRatio({ state: r.state, draft_body: r.draft_body, edit_distance: r.edit_distance }))
    .filter((x): x is number => x !== null)
  const priorRatios = priorRows
    .map(editRatio)
    .filter((x): x is number => x !== null)

  let direction: VoiceDeltaDirection
  let avgCurrent: number | null = null
  let avgPrior: number | null = null
  if (currentRatios.length < MIN_VOICE_DELTA_SAMPLE || priorRatios.length < MIN_VOICE_DELTA_SAMPLE) {
    direction = 'insufficient_sample'
  } else {
    avgCurrent = mean(currentRatios)
    avgPrior = mean(priorRatios)
    const delta = avgCurrent - avgPrior
    // Flat band: <0.5 percentage-points absolute. Below that, calling
    // it "up" or "down" overstates a noisy signal.
    if (Math.abs(delta) < 0.005) direction = 'flat'
    else if (delta < 0)          direction = 'down' // less editing → improving
    else                         direction = 'up'   // more editing → worsening
  }

  const voice_health_delta: BriefingVoiceDelta = {
    sample_size_current: currentRatios.length,
    sample_size_prior:   priorRatios.length,
    avg_edit_ratio_current: avgCurrent,
    avg_edit_ratio_prior:   avgPrior,
    direction,
  }

  // ── Auto-send by class ──────────────────────────────────────────
  // Only auto_sent rows with a known classified_class contribute.
  // Pre-W9 drafts have null classified_class and are silently skipped
  // — the briefing UI never claims "0 in class X" for those.
  const classCounts = new Map<VoiceExampleClass, number>()
  for (const r of rows) {
    if (r.state !== 'auto_sent') continue
    const cls = r.classified_class
    if (!cls || cls === 'unknown') continue
    classCounts.set(cls, (classCounts.get(cls) ?? 0) + 1)
  }
  const auto_send_by_class: BriefingAutoSendClassBucket[] = Array.from(classCounts.entries())
    .map(([cls, count]) => ({ class: cls, label: VOICE_CLASS_LABEL[cls], count }))
    .sort((a, b) => b.count - a.count)

  // ── Pending top: 3 most recent OPEN drafts awaiting human review.
  // Shadow-simulated rows are state='pending' on disk but are not
  // awaiting human action — they're a preview signal. Exclude them.
  const pending_top: BriefingPendingItem[] = rows
    .filter(r => r.state === 'pending' && !r.shadow_simulated)
    .sort((a, b) => b.generated_at.localeCompare(a.generated_at))
    .slice(0, PENDING_TOP_LIMIT)
    .map(r => ({
      id: r.id,
      contact_name: r.contact_name,
      inbound_preview: toPreview(r.inbound_body ?? ''),
      age_minutes: Math.max(0, Math.round((windowEnd.getTime() - new Date(r.generated_at).getTime()) / 60_000)),
    }))

  return {
    window: {
      hours: BRIEFING_WINDOW_HOURS,
      started_at: windowStart.toISOString(),
      ended_at:   windowEnd.toISOString(),
    },
    action_counts,
    pending_top,
    safety_triggers: {
      total_matched_inbounds: triggerHits.length,
      inbound_scanned: inboundRows.length,
      truncated: inboundTruncated,
      by_category,
    },
    voice_health_delta,
    auto_send_by_class,
    generated_at: new Date().toISOString(),
  }
}

// ─── Internals ─────────────────────────────────────────────────────

/**
 * Edit ratio for one row. Same semantics as voice-health.editRatio,
 * but the row shape is narrower here (we only carry the three fields
 * the calculation needs, not the full HealthDraftRow). Returns null
 * when the row is not a human-decision state or signal is missing.
 */
function editRatio(r: { state: BriefingDraftState; draft_body: string; edit_distance: number | null }): number | null {
  if (r.state !== 'sent' && r.state !== 'edited') return null
  if (r.edit_distance === null || r.edit_distance < 0) return null
  const len = (r.draft_body ?? '').length
  if (len <= 0) return null
  return Math.min(1, r.edit_distance / len)
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

/**
 * Redact phone-number-shaped strings (10–11 digit clusters with
 * optional formatting) before the inbound preview is rendered. Same
 * inbound is already shown elsewhere in /ai-drafts/review, so no new
 * PII exposure, but we belt-and-brace it here so the briefing isn't
 * the surface that leaks something subtle.
 */
const PHONE_REDACT_RE = /(?:\+?\d[\s().-]?){10,}/g

function toPreview(body: string): string {
  const redacted = body.replace(PHONE_REDACT_RE, '[phone]').trim()
  if (redacted.length <= PREVIEW_MAX_CHARS) return redacted
  return redacted.slice(0, PREVIEW_MAX_CHARS - 1).trimEnd() + '…'
}
