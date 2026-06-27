/**
 * PHI scrub for LLM-authored free-text fields persisted to
 * activity_log + voice_messages.metadata.
 *
 * Shared by post-call-summary-email + transfer-to-human (and any
 * future voice tool that lets the LLM write a free-text summary).
 *
 * Conservative regex strips:
 *   - Anything that looks like a phone number (7+ digits with
 *     conventional separators). Eats the occasional long benign
 *     number — that's the right trade-off for PHI defense.
 *   - US-shape dates MM/DD/YY, MM-DD-YYYY, and ISO YYYY-MM-DD.
 *
 * The route is responsible for the maxLength cap on the input
 * (post-call-summary uses 280, transfer summary uses 280). This
 * helper trims and slice-caps as a defense-in-depth.
 */

const PHONE_RE   = /(?:\+?\d[\s().-]?){7,}\d/g
const US_DATE_RE = /\b(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{1,2}-\d{1,2})\b/g

export const SUMMARY_MAX_CHARS = 280

export function sanitizeSummary(input: string, maxChars: number = SUMMARY_MAX_CHARS): string {
  return input
    .slice(0, maxChars)
    .replace(PHONE_RE,   '[redacted]')
    .replace(US_DATE_RE, '[redacted]')
    .trim()
}
