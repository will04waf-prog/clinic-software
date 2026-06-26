/**
 * Phase 5 W1 — safety-trigger handoff classifier for voice calls.
 *
 * Wraps the existing src/lib/inbound-classifier.safetyTrigger so
 * the voice agent can route a single utterance to the right handoff
 * action. Three buckets:
 *
 *   - emergency  → "if this is life-threatening dial 911" + bridge
 *                  to fallback OR voicemail. TERMINAL.
 *   - medical    → "I can't give medical advice" + bridge / vm.
 *                  TERMINAL.
 *   - none       → continue receptionist flow.
 *
 * The handoff state is TERMINAL: once we've decided to transfer
 * or take a voicemail, the receptionist flow does NOT resume
 * (W9-review-style "re-entry bug"). The caller can call back to
 * try again, but mid-call we don't fall back into "do you want
 * to book?" after refusing medical advice.
 *
 * Returns the action + script so the voice webhook can build the
 * right TwiML (Dial + Say vs Record + Say).
 */

import { safetyTrigger } from '@/lib/inbound-classifier'
import { safetyHandoffScript } from './disclosure'

export type HandoffAction =
  | { kind: 'continue' }
  | { kind: 'transfer'; script: string; trigger_label: string }
  | { kind: 'voicemail'; script: string; trigger_label: string }

// Heuristic that promotes medical-vs-emergency. The inbound-
// classifier safetyTrigger only returns the matched substring; we
// upgrade to emergency for the most acute cases so the script
// includes the 911 prompt.
const EMERGENCY_PATTERNS = [
  /\b(?:chest|severe)\s+pain\b/i,
  /\bcan'?t\s+breathe\b/i,
  /\bcant\s+breathe\b/i,
  /\bunconscious\b/i,
  /\bbleeding\b/i,
  /\boverdose\b/i,
  /\bkill\s+myself\b/i,
  /\bsuicid(?:e|al)\b/i,
  /\bdying\b/i,
]

function isEmergency(utterance: string): boolean {
  return EMERGENCY_PATTERNS.some(re => re.test(utterance))
}

/**
 * Classify a single caller utterance and decide the handoff action.
 * The voice agent should call this on EVERY user-turn transcript
 * fragment AND any tool-call response that surfaces patient input.
 *
 * If fallback_e164 is empty, transfer downgrades to voicemail so
 * the call doesn't dead-end.
 */
export function classifyHandoff(utterance: string, fallbackE164: string | null | undefined): HandoffAction {
  const trigger = safetyTrigger(utterance)
  if (!trigger) return { kind: 'continue' }

  const emergency = isEmergency(utterance)
  const script = safetyHandoffScript(emergency ? 'emergency' : 'medical')
  const action: HandoffAction['kind'] = fallbackE164 ? 'transfer' : 'voicemail'

  if (action === 'transfer') {
    return { kind: 'transfer', script, trigger_label: trigger }
  }
  return { kind: 'voicemail', script, trigger_label: trigger }
}
