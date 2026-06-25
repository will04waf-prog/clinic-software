/**
 * Phase 4 W3 — booking-intent classifier for inbound SMS.
 *
 * Pure function. No LLM call, no DB. Heuristic regex + service-name
 * matching against the org's catalog.
 *
 * The Twin's existing classifier (src/lib/inbound-classifier.ts)
 * decides whether the message can be auto-sent at all. THIS module
 * decides whether the draft should INCLUDE real available slots. The
 * two are independent: a message can be high-confidence FAQ (auto-
 * send eligible) AND have booking intent (slots get injected). Or it
 * can be safety-trigger-held (never auto-send) AND have booking
 * intent — staff still get a draft with slots to review.
 *
 * Why heuristics, not an LLM:
 *   - Predictable: same input always classifies the same way. No
 *     surprise token-budget blowouts on long inbounds.
 *   - Fast: every inbound runs this before generateDraft does its
 *     ~2-5s Claude call; an extra LLM step would double the latency.
 *   - Safe to be conservative: false negatives just mean "no slots
 *     injected, draft a generic reply" — a soft failure mode. False
 *     positives mean a slot pitch on an unrelated message — annoying
 *     but not dangerous.
 *
 * If the heuristic misses real intent in the wild, W4/W5 can swap
 * this for a cheap small-LLM call. The interface stays the same.
 */

export type BookingIntent = 'book' | 'check_availability' | 'other'

export interface BookingIntentResult {
  intent: BookingIntent
  /**
   * The service name (verbatim) the patient mentioned, when we can
   * find one in the org's catalog. Null when no match — slot fetcher
   * falls back to the org's most-relevant default service.
   */
  serviceHint: string | null
}

// ── Strong booking verbs — fire 'book' intent on their own. ──
// "book", "schedule", "set up", "come in", "make/get an appt".
const STRONG_BOOK_RE = /\b(?:book|booking|schedule|scheduling|set\s+up|come\s+in|stop\s+by|drop\s+in|make\s+(?:an|a)\s+(?:appointment|appt|consult|visit)|get\s+(?:an|a)\s+(?:appointment|appt|consult|visit))\b/i

// ── Soft "I want to" patterns — only promote to 'book' when paired
// with a service mention, a day, or a time. Bare "I want to die" /
// "I want to cancel" / "I want to ask" would otherwise misfire on
// the previous loose regex, generating slot pitches on cancellation,
// complaint, and even self-harm messages.
const SOFT_BOOK_RE = /\b(?:i\s+(?:want|need|would\s+like|'?d\s+like|'?m\s+looking)\s+(?:to|for))\b/i

// ── Availability-check phrases ──
// "what times", "any availability", "when are you open", "got anything"
const AVAILABILITY_RE = /\b(?:what(?:'s|s|\s+is)?\s+(?:your\s+)?(?:available|availability|open|free|next\s+available|next\s+open)|what\s+(?:times?|days?|hours?|slots?|openings?|appointments?)|any\s+(?:availability|openings?|times?|slots?)|when\s+(?:are\s+you|do\s+you)\s+(?:open|have)|got\s+any(?:thing)?|any(?:thing)?\s+open|do\s+you\s+have\s+(?:any|anything|time|times|openings?|slots?)|when\s+can\s+i)\b/i

// ── Day-mention phrases (weaker signal — combined with other cues) ──
// "thursday", "tomorrow", "next week", "this weekend"
const DAY_HINT_RE = /\b(?:today|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun|next\s+(?:week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|this\s+(?:week|weekend))\b/i

// ── Time-mention phrases (weaker signal — "at 2pm") ──
const TIME_HINT_RE = /\b(?:\d{1,2}(?::\d{2})?\s*(?:am|pm)|noon|morning|afternoon|evening)\b/i

// ── Question-mark fallback. When combined with day hint + availability vibe. ──
const QUESTION_RE = /\?/

// ── Negative-context guards — when present, suppress the "service +
// question = soft sell" branch. The patient is asking ABOUT a service
// (price, safety, location), not asking to book one. Pitching slots
// reads as tone-deaf.
const PRICE_INFO_RE    = /\b(?:cost|costs|price|pricing|priced|charge|how\s+much|expensive|cheap|insurance|copay|carecredit|finance|payment|deposit)\b/i
const SAFETY_INFO_RE   = /\b(?:safe|safety|risk|risky|reaction|side\s+effect|allergic|pregnan|nursing|breastfeed|interact|contraindicat|recover)\b/i
const LOCATION_INFO_RE = /\b(?:where|address|located|location|parking|directions|map)\b/i
const CANCEL_INFO_RE   = /\b(?:cancel|cancelling|cancellation|reschedule|move\s+my|push\s+(?:back|out)|complaint|refund)\b/i

/**
 * Find a service name from the org's catalog inside the inbound
 * body. Match is case-insensitive, word-boundary aware, and prefers
 * the LONGEST match (so "lip filler" beats "filler" if both exist).
 * Returns the canonical service name as stored — that's what the
 * fetcher needs to find the row.
 */
function findServiceMention(body: string, serviceNames: string[]): string | null {
  const lower = body.toLowerCase()
  let best: string | null = null
  let bestLen = 0
  for (const name of serviceNames) {
    if (!name) continue
    const lowerName = name.toLowerCase()
    // Plain substring + word-boundary check on both ends.
    const idx = lower.indexOf(lowerName)
    if (idx < 0) continue
    const before = idx === 0 ? ' ' : lower[idx - 1]
    const after  = idx + lowerName.length >= lower.length ? ' ' : lower[idx + lowerName.length]
    if (/[a-z0-9]/.test(before) || /[a-z0-9]/.test(after)) continue
    if (lowerName.length > bestLen) {
      best = name
      bestLen = lowerName.length
    }
  }
  return best
}

/**
 * Public classifier. Pass the raw inbound body + the list of the
 * org's service names (display strings as stored in services.name).
 * Empty list is fine — the function still detects intent, just won't
 * fill serviceHint.
 *
 * Returns 'other' when nothing matches; the Twin then drafts a
 * normal reply with no slot injection.
 */
export function classifyBookingIntent(
  body: string,
  serviceNames: string[] = [],
): BookingIntentResult {
  if (!body || !body.trim()) return { intent: 'other', serviceHint: null }

  // ── Hard negative guards. When the patient is explicitly NOT
  // trying to book — they're asking about price, safety, location,
  // or trying to cancel — never pitch slots. These run BEFORE intent
  // detection so positive signals don't override them.
  const hasCancel   = CANCEL_INFO_RE.test(body)
  const hasPrice    = PRICE_INFO_RE.test(body)
  const hasSafety   = SAFETY_INFO_RE.test(body)
  const hasLocation = LOCATION_INFO_RE.test(body)
  if (hasCancel) return { intent: 'other', serviceHint: null }
  if (hasSafety) return { intent: 'other', serviceHint: null }

  const hasStrong   = STRONG_BOOK_RE.test(body)
  const hasSoft     = SOFT_BOOK_RE.test(body)
  const hasAvail    = AVAILABILITY_RE.test(body)
  const hasDay      = DAY_HINT_RE.test(body)
  const hasTime     = TIME_HINT_RE.test(body)
  const hasQuestion = QUESTION_RE.test(body)
  const serviceHint = findServiceMention(body, serviceNames)

  // ── Strong "book" intent. Explicit verb wins on its own. ──
  if (hasStrong) return { intent: 'book', serviceHint }

  // ── Soft "I want to / I'd like to" — only promote when a service,
  // day, or time also appears in the same message. Stops bare phrases
  // like "I want to die", "I'd like to ask", "I want to cancel" from
  // triggering a slot pitch.
  if (hasSoft && (serviceHint || hasDay || hasTime)) {
    return { intent: 'book', serviceHint }
  }

  // ── Day or time + service mention also reads as book intent.
  // "Thursday for botox" → book. Day alone without a service is the
  // weaker "check_availability" path below.
  if (hasDay && serviceHint) return { intent: 'book', serviceHint }
  if (hasTime && serviceHint) return { intent: 'book', serviceHint }

  // ── Availability questions. "what times do you have", "any openings",
  // "do you have anything Thursday".
  if (hasAvail) return { intent: 'check_availability', serviceHint }
  if (hasDay && hasQuestion) return { intent: 'check_availability', serviceHint }

  // ── Soft sell: service mention + question, BUT only when the
  // message isn't a price/location ask (the negative guards above
  // already excluded safety/cancel). "How much does botox cost?"
  // mentions a service AND has a question mark but it's clearly NOT
  // a booking ask — slot pitch reads as tone-deaf.
  if (serviceHint && hasQuestion && !hasPrice && !hasLocation) {
    return { intent: 'check_availability', serviceHint }
  }

  return { intent: 'other', serviceHint: null }
}
