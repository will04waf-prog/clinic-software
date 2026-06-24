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

export interface EligibilityResult {
  eligible: boolean
  reason_code: EligibilityReasonCode
  /** Human-readable reason for UI display + audit log. */
  reason: string
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

  // All gates passed.
  return { eligible: true, reason_code: 'eligible',
           reason: `Class "${input.messageClass}" passed all trust gates: ${cm.ratio_sample_size} human-handled drafts, ${Math.round(cm.avg_edit_ratio * 100)}% avg edit, ${cm.examples_saved} examples saved.` }
}
