/**
 * Phase 5 W1 — voice-disclosure + recording-consent openers.
 *
 * Every inbound call MUST start with these lines BEFORE any
 * conversational AI handoff:
 *
 *   1. AI disclosure ("you're speaking with an AI assistant...")
 *      — the voice analog of the SMS disclosureFooter() from
 *      src/lib/ai-twin.ts. Mandatory; not toggleable.
 *
 *   2. Recording consent ("this call may be recorded...") —
 *      covers two-party-consent states (CA, FL, IL, MA, MD, MT, NV,
 *      NH, PA, WA) without needing geo-detection on the inbound IP.
 *      Caller is asked to press a key OR say "yes" — captured as
 *      contacts.voice_recording_consent + _at on the call-end
 *      webhook.
 *
 * Output is plain text; the Twilio webhook wraps it in a <Say> and
 * the Vapi side picks it up as the agent's first utterance via the
 * firstMessage param. We keep them as plain strings (not TwiML) so
 * the same copy works for both delivery channels and translation
 * is a one-line change later.
 */

export function disclosureOpener(clinicName: string): string {
  const safe = clinicName?.trim() || 'this clinic'
  return `Hi, thanks for calling ${safe}. You're speaking with an AI assistant. I can help with appointments and general questions, or I can take a message and have a team member call you back.`
}

export function recordingConsentLine(): string {
  return `This call may be recorded for quality and record-keeping. If you'd prefer not to be recorded, please say "no recording" now, otherwise we'll go ahead.`
}

/**
 * After-hours opener — different from disclosure: explains the
 * agent is on duty because the clinic is closed, so the caller's
 * expectations are calibrated. Played when call_agent_mode =
 * 'after_hours' AND the current clinic-local time is outside the
 * business_hours window.
 */
export function afterHoursOpener(clinicName: string): string {
  const safe = clinicName?.trim() || 'this clinic'
  return `Hi, thanks for calling ${safe}. We're closed right now, but I'm an AI assistant who can book appointments or take a message for the team.`
}

/**
 * Safety-handoff script. Spoken before bridging the call to the
 * fallback number (or before leaving voicemail mode). Terminal —
 * the receptionist flow never resumes after this.
 */
export function safetyHandoffScript(kind: 'medical' | 'emergency' | 'other'): string {
  if (kind === 'emergency') {
    return `It sounds like this could be an emergency. If this is life-threatening, please hang up and dial 9-1-1. Otherwise, I'm going to connect you with the clinic team now.`
  }
  if (kind === 'medical') {
    return `I'm not able to give medical advice over the phone. Let me connect you with the clinic team.`
  }
  return `Let me connect you with the clinic team.`
}

/**
 * Voicemail handoff — when there's no fallback_e164 configured
 * OR the fallback didn't pick up. Tells the caller a team member
 * will follow up.
 */
export function voicemailHandoffScript(): string {
  return `I'll make sure a team member calls you back as soon as possible. Please leave a brief message with your name and reason for calling after the tone.`
}
