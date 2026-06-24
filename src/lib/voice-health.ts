/**
 * Voice training health — Phase 2 W8.
 *
 * Aggregates the edit-distance + voice-metadata fields W7 started
 * persisting on ai_drafts (state + edit_distance + context_snapshot)
 * into per-class metrics + actionable recommendations the clinic
 * owner can act on in Settings. The same per-class metrics feed
 * W9's auto-send eligibility check (low-edit classes are candidates
 * for autonomous send).
 *
 * Pure functions only — no DB access. The route wrapper at
 * /api/org/voice-health fetches rows and calls computeVoiceHealth.
 *
 * Drafts that predate W7 (no voice_class in context_snapshot) are
 * bucketed under 'pre_voice' and excluded from per-class metrics so
 * they don't pollute the signal.
 *
 * Comparison signal (drafts WITH exemplars vs WITHOUT) is keyed off
 * the per-draft voice_examples_used counter — NOT voice_applied. The
 * latter is a one-way ratchet (once any voice config is saved, all
 * future drafts get voice_applied=true), so the "without_voice"
 * bucket ages out of the rolling window. voice_examples_used varies
 * per-draft because example selection depends on class + fallback +
 * what the org has saved.
 *
 * The "edited less" comparison is observational, not randomized —
 * UI copy reflects that (descriptive, not causal).
 */

import {
  VOICE_EXAMPLE_CLASSES,
  type VoiceExampleClass,
  type VoiceProfile,
} from '@/lib/voice-profile'

// ─── Tunables ──────────────────────────────────────────────────────

/** Drafts older than this are excluded from the rolling window. */
export const HEALTH_WINDOW_DAYS = 30

/**
 * Minimum sample size — applies to the ratios subset, not raw row
 * count. A class with 5 sent/edited drafts produces a usable mean;
 * 5 rejected drafts and 1 sent doesn't, because N=1.
 */
export const MIN_DRAFTS_FOR_SIGNAL = 5

/** Edit ratio above this is considered a heavy edit (≥50% rewritten). */
export const HEAVY_EDIT_RATIO = 0.5

/** Edit ratio above this is considered a significant edit (≥20%). */
export const SIGNIFICANT_EDIT_RATIO = 0.2

/**
 * Classes with avg edit ratio above this in the window are flagged
 * as "needs more training examples." Tuned conservatively: only
 * classes where the typical draft is rewritten by a fifth or more.
 */
export const RECOMMEND_ADD_EXAMPLES_RATIO = 0.25

/**
 * Banned phrase rate threshold (fraction of drafts in window). Below
 * this and a few absolute hits look normal; above this the guardrail
 * is firing too often and likely catches false positives.
 */
export const BANNED_PHRASE_RATE_THRESHOLD = 0.05
export const BANNED_PHRASE_MIN_HITS = 3

/** Voice-lift delta thresholds (sign convention: delta = without - with). */
export const VOICE_LIFT_POSITIVE_THRESHOLD = 0.05  // ≥5% reduction → "doing well"
export const VOICE_LIFT_NEGATIVE_THRESHOLD = -0.05 // ≤-5% (worse) → "harmful"

// ─── Types ─────────────────────────────────────────────────────────

export type HealthDraftState = 'sent' | 'edited' | 'rejected' | 'guardrail_failed' | 'pending' | 'expired' | 'auto_sent'

/**
 * Row shape we pull from ai_drafts. The voice_* fields live inside
 * the context_snapshot jsonb — caller extracts them at query time so
 * the aggregator stays a pure data function.
 */
export interface HealthDraftRow {
  id: string
  state: HealthDraftState
  draft_body: string
  edit_distance: number | null
  guardrail_violation: string | null
  generated_at: string
  /** Pulled from context_snapshot->>'voice_class'. null for pre-W7 drafts. */
  voice_class: VoiceExampleClass | null
  /** Pulled from context_snapshot->>'voice_examples_used'. null for pre-W7 drafts. */
  voice_examples_used: number | null
}

export interface ExampleCountByClass {
  greeting:        number
  faq:             number
  follow_up:       number
  consult_confirm: number
  follow_up_cold:  number
  custom:          number
}

export interface ClassMetrics {
  class: VoiceExampleClass
  /** Total drafts generated for this class in the window (any state). */
  drafts_total: number
  /** Drafts in a terminal/resolved state (used as bar denominator). */
  drafts_resolved: number
  sent_unchanged: number
  sent_with_minor_edits: number
  sent_with_significant_edits: number
  sent_with_heavy_edits: number
  /** Phase 2 W9 — drafts auto-sent without human review. */
  auto_sent: number
  rejected: number
  guardrail_failed: number
  /**
   * Mean edit ratio across sent+edited drafts with a known edit
   * distance. null when fewer than MIN_DRAFTS_FOR_SIGNAL contributing
   * rows exist (sample too small to be informative).
   */
  avg_edit_ratio: number | null
  /** Sample size used to compute avg_edit_ratio. */
  ratio_sample_size: number
  /** Count of saved voice_examples for this class. */
  examples_saved: number
}

export type RecommendationKind =
  | 'no_examples_for_class'
  | 'high_edit_class'
  | 'banned_phrase_noisy'
  | 'voice_empty'
  | 'voice_under_trained'
  | 'voice_hurting'
  | 'great_voice_low_edits'

export type RecommendationSeverity = 'info' | 'warn' | 'good'

export interface Recommendation {
  kind: RecommendationKind
  severity: RecommendationSeverity
  title: string
  detail: string
  class?: VoiceExampleClass
}

export interface VoiceLiftStats {
  /** Mean edit ratio among drafts that had >=1 example injected. */
  with_examples_avg_edit_ratio: number
  /** Mean edit ratio among drafts that had 0 examples injected. */
  without_examples_avg_edit_ratio: number
  /** without - with. Positive = examples reduce edits. */
  delta: number
  with_examples_sample_size: number
  without_examples_sample_size: number
}

export interface VoiceHealth {
  window_start_iso: string
  window_days: number
  /** All drafts in the window (any class, any state). */
  drafts_in_window: number
  /** Drafts in the window that have voice_class set (W7+ drafts). */
  drafts_with_voice_tagged: number
  /** Drafts where guardrail_violation='banned_phrase'. */
  banned_phrase_hits: number
  /**
   * Comparison: drafts that had voice exemplars in their prompt vs
   * drafts that didn't. null when either side has fewer than
   * MIN_DRAFTS_FOR_SIGNAL contributing rows.
   */
  voice_lift: VoiceLiftStats | null
  per_class: ClassMetrics[]
  recommendations: Recommendation[]
}

// ─── Aggregation ───────────────────────────────────────────────────

export function computeVoiceHealth(
  rows: ReadonlyArray<HealthDraftRow>,
  examplesByClass: ExampleCountByClass,
  profile: Required<VoiceProfile>,
  windowStart: Date,
): VoiceHealth {
  const inWindow = rows.filter(r => new Date(r.generated_at) >= windowStart)

  const draftsWithVoiceTagged = inWindow.filter(r => r.voice_class !== null).length

  const banned_phrase_hits = inWindow.filter(
    r => r.state === 'guardrail_failed' && r.guardrail_violation === 'banned_phrase',
  ).length

  // ── Per-class buckets ────────────────────────────────────────────
  const perClass: ClassMetrics[] = VOICE_EXAMPLE_CLASSES.map(cls => {
    const classRows = inWindow.filter(r => r.voice_class === cls)
    const ratios = classRows
      .map(r => editRatio(r))
      .filter((x): x is number => x !== null)

    const counts = bucketByEdit(classRows)
    const drafts_resolved =
      counts.sent_unchanged +
      counts.sent_with_minor_edits +
      counts.sent_with_significant_edits +
      counts.sent_with_heavy_edits +
      counts.auto_sent +
      counts.rejected +
      counts.guardrail_failed

    // Gate on the ratios sample size — the actual N feeding the mean.
    const avg_edit_ratio = ratios.length >= MIN_DRAFTS_FOR_SIGNAL ? mean(ratios) : null

    return {
      class: cls,
      drafts_total: classRows.length,
      drafts_resolved,
      ...counts,
      avg_edit_ratio,
      ratio_sample_size: ratios.length,
      examples_saved: examplesByClass[cls] ?? 0,
    }
  })

  // ── Voice lift (drafts WITH example exemplars vs WITHOUT) ──────
  // voice_examples_used = number of exemplars actually injected. Per-
  // draft, so the comparison stays valid forever — no ratchet.
  const examplesUsedKnown = inWindow.filter(r => typeof r.voice_examples_used === 'number')
  const withExamplesRows    = examplesUsedKnown.filter(r => (r.voice_examples_used ?? 0) >= 1)
  const withoutExamplesRows = examplesUsedKnown.filter(r => (r.voice_examples_used ?? 0) === 0)
  const withRatios    = withExamplesRows   .map(editRatio).filter((x): x is number => x !== null)
  const withoutRatios = withoutExamplesRows.map(editRatio).filter((x): x is number => x !== null)

  const voice_lift: VoiceLiftStats | null =
    withRatios.length >= MIN_DRAFTS_FOR_SIGNAL && withoutRatios.length >= MIN_DRAFTS_FOR_SIGNAL
      ? {
          with_examples_avg_edit_ratio:    mean(withRatios),
          without_examples_avg_edit_ratio: mean(withoutRatios),
          delta: mean(withoutRatios) - mean(withRatios),
          with_examples_sample_size: withRatios.length,
          without_examples_sample_size: withoutRatios.length,
        }
      : null

  // ── Recommendations ──────────────────────────────────────────────
  const recommendations = buildRecommendations({
    perClass,
    banned_phrase_hits,
    drafts_in_window: inWindow.length,
    drafts_with_voice_tagged: draftsWithVoiceTagged,
    profile,
    voice_lift,
    total_examples_saved: sumExamples(examplesByClass),
  })

  return {
    window_start_iso: windowStart.toISOString(),
    window_days: HEALTH_WINDOW_DAYS,
    drafts_in_window: inWindow.length,
    drafts_with_voice_tagged: draftsWithVoiceTagged,
    banned_phrase_hits,
    voice_lift,
    per_class: perClass,
    recommendations,
  }
}

// ─── Internals ─────────────────────────────────────────────────────

/**
 * Edit ratio for a single row. Only sent or edited drafts contribute
 * a ratio — rejected/expired/pending/guardrail_failed don't have a
 * meaningful "human edited X chars" signal. Returns null otherwise,
 * AND when edit_distance/draft_body length is missing — null is
 * "no signal," not "small signal."
 */
function editRatio(r: HealthDraftRow): number | null {
  if (r.state !== 'sent' && r.state !== 'edited') return null
  if (r.edit_distance === null || r.edit_distance < 0) return null
  const len = (r.draft_body ?? '').length
  if (len <= 0) return null
  return Math.min(1, r.edit_distance / len)
}

interface EditBuckets {
  sent_unchanged: number
  sent_with_minor_edits: number
  sent_with_significant_edits: number
  sent_with_heavy_edits: number
  auto_sent: number
  rejected: number
  guardrail_failed: number
}

function bucketByEdit(rows: ReadonlyArray<HealthDraftRow>): EditBuckets {
  const b: EditBuckets = {
    sent_unchanged: 0,
    sent_with_minor_edits: 0,
    sent_with_significant_edits: 0,
    sent_with_heavy_edits: 0,
    auto_sent: 0,
    rejected: 0,
    guardrail_failed: 0,
  }
  for (const r of rows) {
    if (r.state === 'sent') {
      b.sent_unchanged += 1
      continue
    }
    if (r.state === 'auto_sent') {
      // Separate bucket — auto-sent has no human edit signal, so
      // it doesn't belong in sent_unchanged or any edit-ratio
      // bucket. Surfaced distinctly in the UI.
      b.auto_sent += 1
      continue
    }
    if (r.state === 'edited') {
      const ratio = editRatio(r)
      // Skip rows where we can't compute a meaningful ratio — they
      // shouldn't be counted as "minor edits" by default (silent lie).
      if (ratio === null) continue
      if (ratio < SIGNIFICANT_EDIT_RATIO)      b.sent_with_minor_edits += 1
      else if (ratio < HEAVY_EDIT_RATIO)       b.sent_with_significant_edits += 1
      else                                     b.sent_with_heavy_edits += 1
      continue
    }
    if (r.state === 'rejected')         b.rejected         += 1
    if (r.state === 'guardrail_failed') b.guardrail_failed += 1
    // pending + expired intentionally excluded — no human decision
    // was recorded for these.
  }
  return b
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

function sumExamples(e: ExampleCountByClass): number {
  return e.greeting + e.faq + e.follow_up + e.consult_confirm + e.follow_up_cold + e.custom
}

function buildRecommendations(args: {
  perClass: ClassMetrics[]
  banned_phrase_hits: number
  drafts_in_window: number
  drafts_with_voice_tagged: number
  profile: Required<VoiceProfile>
  voice_lift: VoiceLiftStats | null
  total_examples_saved: number
}): Recommendation[] {
  const recs: Recommendation[] = []

  // Per-class: heavily-edited drafts → suggest adding examples
  for (const cm of args.perClass) {
    if (cm.avg_edit_ratio !== null && cm.avg_edit_ratio >= RECOMMEND_ADD_EXAMPLES_RATIO) {
      const pct = Math.round(cm.avg_edit_ratio * 100)
      recs.push({
        kind: 'high_edit_class',
        severity: 'warn',
        class: cm.class,
        title: `Drafts in "${prettyClass(cm.class)}" are edited a lot`,
        detail: `Avg ${pct}% of the draft text is rewritten before sending. Add a few more example messages for this class so the AI can match how you actually reply.`,
      })
    }
  }

  // Per-class: zero examples for a class that's seeing real volume.
  for (const cm of args.perClass) {
    if (cm.drafts_total >= MIN_DRAFTS_FOR_SIGNAL && cm.examples_saved === 0) {
      recs.push({
        kind: 'no_examples_for_class',
        severity: 'info',
        class: cm.class,
        title: `No examples saved for "${prettyClass(cm.class)}"`,
        detail: `${cm.drafts_total} drafts in this class were generated using fallback examples. Save 2-3 real "${prettyClass(cm.class)}" replies to teach the AI your specific voice.`,
      })
    }
  }

  // Banned-phrase guardrail rate too high — likely false positives.
  // Gated on absolute floor (≥3) AND rate (≥5% of drafts in window)
  // so a high-volume org with a tiny absolute rate doesn't get nagged.
  if (args.banned_phrase_hits >= BANNED_PHRASE_MIN_HITS &&
      args.drafts_in_window > 0 &&
      args.banned_phrase_hits / args.drafts_in_window >= BANNED_PHRASE_RATE_THRESHOLD) {
    const ratePct = Math.round((args.banned_phrase_hits / args.drafts_in_window) * 100)
    recs.push({
      kind: 'banned_phrase_noisy',
      severity: 'warn',
      title: 'Banned-phrase guardrail firing often',
      detail: `${args.banned_phrase_hits} of ${args.drafts_in_window} drafts (${ratePct}%) tripped the banned-phrase safety net in the last ${HEALTH_WINDOW_DAYS} days. Check your banned phrases list — short or common words can cause false positives.`,
    })
  }

  // Voice training is completely empty.
  const hasAnyProfileRule =
    args.profile.tone_formal < 25 || args.profile.tone_formal > 75 ||
    args.profile.tone_warm   < 25 || args.profile.tone_warm   > 75 ||
    args.profile.banned_phrases.length > 0 ||
    !!args.profile.custom_signoff
  if (args.total_examples_saved === 0 && !hasAnyProfileRule) {
    recs.push({
      kind: 'voice_empty',
      severity: 'info',
      title: 'Voice training is empty',
      detail: 'AI drafts use the generic prompt until you save a few example messages or nudge the tone sliders. 5 examples is enough to see a real difference.',
    })
  } else if (args.total_examples_saved > 0 && args.total_examples_saved < 5) {
    // Under-trained — some examples saved but below the recommended floor.
    recs.push({
      kind: 'voice_under_trained',
      severity: 'info',
      title: `Add a few more example messages`,
      detail: `You've saved ${args.total_examples_saved}. The AI's voice match improves measurably once you reach about 5 examples across the message types you use most.`,
    })
  }

  // Negative voice lift — exemplars are making drafts WORSE.
  if (args.voice_lift && args.voice_lift.delta <= VOICE_LIFT_NEGATIVE_THRESHOLD) {
    const pct = Math.round(Math.abs(args.voice_lift.delta) * 100)
    recs.push({
      kind: 'voice_hurting',
      severity: 'warn',
      title: `Drafts using your examples are edited ${pct}% MORE`,
      detail: `Drafts with voice examples are being edited more than drafts without. Some examples might be steering the AI wrong — try removing the oldest examples or pruning ones that don't match your current style.`,
    })
  }

  // Positive voice lift — exemplars are noticeably helping.
  if (args.voice_lift && args.voice_lift.delta >= VOICE_LIFT_POSITIVE_THRESHOLD) {
    const pct = Math.round(args.voice_lift.delta * 100)
    recs.push({
      kind: 'great_voice_low_edits',
      severity: 'good',
      title: `Drafts using your voice are edited ${pct}% less`,
      detail: `Drafts with at least one matching example are edited noticeably less than drafts without. Adding more examples may push this further.`,
    })
  }

  return recs
}

function prettyClass(cls: VoiceExampleClass): string {
  // Mirrors VOICE_CLASS_LABEL in voice-profile.ts. Kept inline here
  // for the recommendation detail strings since this module already
  // imports the enum but UI labels come from there.
  switch (cls) {
    case 'greeting':        return 'Welcome / first reply'
    case 'faq':             return 'Answering a question'
    case 'follow_up':       return 'Follow-up nudge'
    case 'consult_confirm': return 'Consult confirmation'
    case 'follow_up_cold':  return 'Re-engaging cold lead'
    case 'custom':          return 'Other'
  }
}
