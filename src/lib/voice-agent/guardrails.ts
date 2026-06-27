/**
 * Phase 5 W1 — voice utterance guardrails.
 *
 * Thin wrapper around src/lib/ai-twin.checkGuardrails that pipes
 * every LLM utterance through the same content rules BEFORE Vapi
 * synthesizes the audio. The SMS guardrails are the source of
 * truth — voice should never speak something the SMS twin would
 * have refused to text.
 *
 * Differences from SMS:
 *   - The 160-char length cap doesn't apply (voice utterances are
 *     longer than texts and the medium has no character budget).
 *     We strip that rule by allowing length up through ~600 chars
 *     here, which still catches runaway-rambling output.
 *   - Calendar-commit rule stays. The voice agent CAN pitch
 *     specific times (we hand it real-availability slots) but
 *     must NOT say "I've booked you for Tuesday at 2pm" — that's
 *     a hold/confirm tool call away.
 *
 * Returns { ok: true } or { ok: false, violation } matching the
 * SMS signature, so the caller can decide whether to speak the
 * utterance, re-prompt the LLM, or fall back to a generic line.
 */

import { checkGuardrails } from '@/lib/ai-twin'

const MAX_VOICE_UTTERANCE_LENGTH = 600 // ~30 spoken seconds

export function checkVoiceUtterance(
  text: string,
  opts?: { bannedPhrases?: string[] },
): { ok: true } | { ok: false; violation: string } {
  if (text.trim().length > MAX_VOICE_UTTERANCE_LENGTH) {
    return { ok: false, violation: 'too_long' }
  }
  // Reuse SMS guardrails. The calendar-commit allowance flag from
  // W3 ('allowCalendarCommit') stays OFF for voice — the agent
  // doesn't synthesize specific times; the slot proposals are
  // structured tool outputs read back verbatim, not LLM-authored
  // sentences that need exempting.
  //
  // PREVIOUSLY this passed `text.slice(0, 159)` to dodge the SMS
  // 160-char length cap. That worked, but the side effect was that
  // EVERY content rule (price, dose, banned-phrase, calendar-commit)
  // only saw the first 159 chars — an utterance could smuggle a $999
  // quote or a banned phrase past 160 and ship clean. The 600-char
  // voice ceiling above already protects against runaway length;
  // what we needed was a way to suppress the SMS length rule WITHOUT
  // hiding the rest of the body from the content scans. The
  // allowLengthOverride flag added to checkGuardrails does exactly
  // that — content rules see the full text, length cap is skipped.
  return checkGuardrails(text, {
    bannedPhrases:       opts?.bannedPhrases,
    allowCalendarCommit: false,
    allowLengthOverride: true,
  })
}
