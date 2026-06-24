/**
 * Auto-send eligibility — Phase 2 W9.
 *
 * Pure function: combines org settings, per-class voice-health
 * metrics, safety trigger result, and quiet-hours state into a
 * binary {eligible, reason, reason_code}. The autonomous-send path
 * in autoDraftForInbound consumes this; anything other than
 * `eligible: true` falls back to the existing human-review flow.
 *
 * Default posture is REFUSAL — the function defaults to ineligible
 * and only flips eligible when ALL gates pass. New gates can be
 * added without changing the contract.
 */

import {
  type VoiceExampleClass,
} from '@/lib/voice-profile'
import {
  type ClassMetrics,
} from '@/lib/voice-health'
import { bucketForContactClass } from '@/lib/auto-send-bucket'

// ─── Trust criteria ────────────────────────────────────────────────
//
// Tuned conservatively. A class needs real volume + low edits + the
// owner has invested in voice training before autonomous send is
// even considered.

export const AUTO_SEND_MIN_RESOLVED_DRAFTS = 20
export const AUTO_SEND_MAX_AVG_EDIT_RATIO  = 0.15
export const AUTO_SEND_MIN_EXAMPLES_SAVED  = 3

// Recency floor on banned-phrase guardrail hits — if the org has
// caught even one banned phrase in the last 7 days, treat the
// trust signal as fragile and hold for human review.
export const AUTO_SEND_BANNED_PHRASE_LOOKBACK_DAYS = 7

// ─── Types ─────────────────────────────────────────────────────────

export type EligibilityReasonCode =
  | 'eligible'
  | 'org_master_disabled'
  | 'class_not_in_allowlist'
  | 'class_is_unknown'
  | 'safety_trigger_matched'
  | 'in_quiet_hours'
  | 'no_sms_consent'
  | 'contact_opted_out'
  | 'class_below_volume_threshold'
  | 'class_edit_ratio_too_high'
  | 'class_examples_too_few'
  | 'recent_banned_phrase_hit'
  | 'voice_health_unavailable'
  | 'rollout_throttled'
  | 'shadow_mode'

export interface EligibilityResult {
  eligible: boolean
  reason_code: EligibilityReasonCode
  /** Human-readable reason for UI display + audit log. */
  reason: string
  /**
   * W12: true when every real gate (including the rollout dial when
   * applicable) would have allowed an auto-send, but shadow mode is
   * on so we did not actually fire. Lets the caller distinguish a
   * genuine refusal from a "would-have-sent" simulation.
   */
  shadow_mode_active?: boolean
}

export interface EligibilityInput {
  /** Master toggle on the org (organizations.ai_twin_auto_send_enabled). */
  orgMasterEnabled: boolean
  /** Per-class allowlist on the org (organizations.ai_twin_auto_send_classes). */
  orgAllowlist: ReadonlyArray<string>
  /** Classifier output. 'unknown' is never eligible. */
  messageClass: VoiceExampleClass | 'unknown'
  /** Safety trigger label from inbound classifier (null = no trigger). */
  safetyTriggerLabel: string | null
  /** True if we're inside the org's configured quiet-hours window. */
  isInQuietHours: boolean
  /** contacts.sms_consent (must be true for autonomous send). */
  hasSmsConsent: boolean
  /** contacts.opted_out_sms (must be false for autonomous send). */
  contactOptedOut: boolean
  /**
   * Per-class metrics from voice-health for THIS class.
   * If null, treat as voice_health_unavailable (refuse).
   */
  classMetrics: ClassMetrics | null
  /**
   * Count of guardrail_violation='banned_phrase' rows on ai_drafts
   * for this org in the last AUTO_SEND_BANNED_PHRASE_LOOKBACK_DAYS.
   * Caller computes this from a small query.
   */
  recentBannedPhraseHits: number
  /**
   * W12: org-level rollout dial. 0..100 in 10-step increments.
   * Default 100 (preserves W9 behavior). Bucketed per contact-class
   * via FNV-1a hash so a given contact is sticky in/out of the cohort.
   */
  rolloutPct?: number
  /**
   * W12: contact id used to seed the rollout bucket hash. Optional
   * for backward compat with callers that don't need rollout (e.g.
   * the Settings UI probe). When omitted, the rollout gate is
   * skipped — caller is responsible for knowing this is a probe.
   */
  contactId?: string
  /**
   * W12: when true, all real gates are still evaluated but a passing
   * result becomes 'shadow_mode' (not eligible) so the caller can
   * persist a would-have-sent marker without invoking Twilio.
   */
  shadowMode?: boolean
}

// ─── Eligibility check ─────────────────────────────────────────────

export function checkAutoSendEligibility(input: EligibilityInput): EligibilityResult {
  // 1. Master toggle.
  if (!input.orgMasterEnabled) {
    return { eligible: false, reason_code: 'org_master_disabled',
             reason: 'Autonomous mode is off for this organization.' }
  }

  // 2. Classifier confidence.
  if (input.messageClass === 'unknown') {
    return { eligible: false, reason_code: 'class_is_unknown',
             reason: "We couldn't classify this message confidently — held for review." }
  }

  // 3. Per-class allowlist.
  if (!input.orgAllowlist.includes(input.messageClass)) {
    return { eligible: false, reason_code: 'class_not_in_allowlist',
             reason: `The "${input.messageClass}" class is not in this org's auto-send allowlist.` }
  }

  // 4. Hard safety triggers — medical / legal / cancellation /
  // complaint / urgency. These ALWAYS short-circuit even when the
  // class is allowlisted.
  if (input.safetyTriggerLabel) {
    return { eligible: false, reason_code: 'safety_trigger_matched',
             reason: `Inbound matched the safety blocklist ("${input.safetyTriggerLabel}") — held for human review.` }
  }

  // 5. Contact consent.
  if (input.contactOptedOut) {
    return { eligible: false, reason_code: 'contact_opted_out',
             reason: 'Contact has opted out of SMS.' }
  }
  if (!input.hasSmsConsent) {
    return { eligible: false, reason_code: 'no_sms_consent',
             reason: 'Contact has not granted SMS consent.' }
  }

  // 6. Quiet hours.
  if (input.isInQuietHours) {
    return { eligible: false, reason_code: 'in_quiet_hours',
             reason: 'Currently inside the org\'s quiet-hours window.' }
  }

  // 7. Recent banned-phrase hits — voice training is producing
  // policy-violating drafts somewhere, so trust signal is fragile.
  if (input.recentBannedPhraseHits > 0) {
    return { eligible: false, reason_code: 'recent_banned_phrase_hit',
             reason: `Banned-phrase guardrail fired ${input.recentBannedPhraseHits} time(s) in the last ${AUTO_SEND_BANNED_PHRASE_LOOKBACK_DAYS} days — voice training may need attention before auto-send resumes.` }
  }

  // 8. Per-class trust thresholds.
  //
  // We gate volume on ratio_sample_size (the count of sent+edited
  // drafts with a known edit_distance) rather than drafts_resolved.
  // drafts_resolved includes auto_sent rows that contribute no
  // edit-quality signal — counting them would let the volume gate
  // pass while the actual ratio is computed from a vanishing sample
  // (feedback-poisoning once auto-send turns on).
  const cm = input.classMetrics
  if (!cm) {
    return { eligible: false, reason_code: 'voice_health_unavailable',
             reason: 'Voice health metrics unavailable — held for review.' }
  }
  if (cm.ratio_sample_size < AUTO_SEND_MIN_RESOLVED_DRAFTS) {
    return { eligible: false, reason_code: 'class_below_volume_threshold',
             reason: `Class needs at least ${AUTO_SEND_MIN_RESOLVED_DRAFTS} human-handled sent or edited drafts to establish a reliable signal (currently ${cm.ratio_sample_size}).` }
  }
  if (cm.avg_edit_ratio === null) {
    return { eligible: false, reason_code: 'class_below_volume_threshold',
             reason: 'Not enough sent/edited drafts in this class to compute an edit ratio yet.' }
  }
  if (cm.avg_edit_ratio > AUTO_SEND_MAX_AVG_EDIT_RATIO) {
    const pct = Math.round(cm.avg_edit_ratio * 100)
    return { eligible: false, reason_code: 'class_edit_ratio_too_high',
             reason: `Drafts in this class are edited ${pct}% on average — above the ${Math.round(AUTO_SEND_MAX_AVG_EDIT_RATIO * 100)}% auto-send threshold. Add more examples or refine the existing ones.` }
  }
  if (cm.examples_saved < AUTO_SEND_MIN_EXAMPLES_SAVED) {
    return { eligible: false, reason_code: 'class_examples_too_few',
             reason: `Class needs at least ${AUTO_SEND_MIN_EXAMPLES_SAVED} saved voice examples before auto-send (currently ${cm.examples_saved}).` }
  }

  // 9. W12 — shadow mode short-circuits BEFORE the rollout dial so
  // owners see the full set of would-be sends (not just the ones
  // inside the current rollout cohort). This matches the
  // "show me everything I would do" intent.
  if (input.shadowMode === true) {
    return {
      eligible: false,
      reason_code: 'shadow_mode',
      shadow_mode_active: true,
      reason: 'Shadow mode — would have auto-sent, did not.',
    }
  }

  // 10. W12 — rollout dial. Stable per-contact bucket via FNV-1a so
  // the same patient never flaps between auto-sent and human review
  // on identical inbound types. Skipped when no contactId is given
  // (probe path in Settings UI uses this — "in principle eligibility").
  const rolloutPct = typeof input.rolloutPct === 'number' ? input.rolloutPct : 100
  if (rolloutPct < 100 && input.contactId) {
    const bucket = bucketForContactClass(input.contactId, input.messageClass)
    if (bucket >= rolloutPct) {
      return {
        eligible: false,
        reason_code: 'rollout_throttled',
        reason: `Rolled out to ${rolloutPct}% — this contact (bucket ${bucket}) is not in the rollout cohort yet.`,
      }
    }
  }

  // All gates passed.
  return { eligible: true, reason_code: 'eligible',
           reason: `Class "${input.messageClass}" passed all trust gates: ${cm.ratio_sample_size} human-handled drafts, ${Math.round(cm.avg_edit_ratio * 100)}% avg edit, ${cm.examples_saved} examples saved.` }
}
