/**
 * Inbound message classification + safety triggers — Phase 2 W9.
 *
 * Two pure functions:
 *   - safetyTrigger(body)    → matched keyword or null. Any non-null
 *                              result means "NEVER auto-send" — the
 *                              message is potentially urgent / medical
 *                              / legal / cancellation and a human MUST
 *                              see it.
 *   - classifyInbound(body, history) → one of VoiceExampleClass or the
 *                              sentinel 'unknown'. 'unknown' is never
 *                              auto-send eligible regardless of org
 *                              settings.
 *
 * Heuristic-based (regex + history shape). We deliberately ERR ON THE
 * SIDE OF 'unknown' — a misclassification that holds for review is a
 * minor annoyance; a misclassification that auto-sends an
 * inappropriate reply is a real harm.
 */

import { type VoiceExampleClass } from '@/lib/voice-profile'

export type ClassifierResult = VoiceExampleClass | 'unknown'

// ─── Safety triggers ──────────────────────────────────────────────
//
// Categories:
//   medical    — adverse reactions, urgent care, post-procedure pain
//   contraindication — conditions that contraindicate procedures
//   pregnancy  — pregnancy/breastfeeding (separate category for clarity)
//   minor      — under-18 references
//   self_harm  — suicidal/self-injury ideation
//   cognitive  — confusion / "who is this"
//   cancel     — cancellation, refund, reschedule requests
//   complaint  — explicit dissatisfaction
//   privacy    — explicit "call me", "private", "confidential"
//   legal      — anything that smells like a legal threat
//   urgency    — explicit time pressure
//   financial  — financial distress
//   escalation — public-review / reporting threats
//
// We err on the side of MORE categories. A false safety positive is
// "held for human review" — fine. A false negative is "auto-replied
// to a sensitive situation" — bad.

interface SafetyRule {
  category:
    | 'medical' | 'contraindication' | 'pregnancy' | 'minor' | 'self_harm'
    | 'cognitive' | 'cancel' | 'complaint' | 'privacy' | 'legal' | 'urgency'
    | 'financial' | 'escalation' | 'empty_body'
  pattern: RegExp
  label: string
}

const SAFETY_RULES: ReadonlyArray<SafetyRule> = [
  // ── Self-harm / suicide (highest priority) ──
  { category: 'self_harm', pattern: /\bkill\s+(?:my\s*self|me)\b/i,    label: 'self-harm' },
  { category: 'self_harm', pattern: /\bsuicid(?:e|al)\b/i,             label: 'suicidal' },
  { category: 'self_harm', pattern: /\bend\s+(?:it\s+all|my\s+life)\b/i, label: 'end my life' },
  { category: 'self_harm', pattern: /\bself[\s-]*harm\b/i,             label: 'self-harm' },
  { category: 'self_harm', pattern: /\bhurt\s+my\s*self\b/i,           label: 'hurt myself' },
  { category: 'self_harm', pattern: /\bwant\s+to\s+die\b/i,            label: 'want to die' },
  { category: 'self_harm', pattern: /\boverdos(?:e|ed|ing)\b/i,        label: 'overdose' },

  // ── Minors ──
  { category: 'minor', pattern: /\b(?:my\s+)?(?:daughter|son|kid|child|teen|teenager)\b/i, label: 'minor reference' },
  { category: 'minor', pattern: /\b1[0-7]\s*(?:yo|y\/o|years?\s*old|yr|yrs)\b/i, label: 'age under 18' },
  { category: 'minor', pattern: /\bminor\b/i,                          label: 'minor' },
  { category: 'minor', pattern: /\bunder\s*18\b/i,                     label: 'under 18' },
  { category: 'minor', pattern: /\bunderage\b/i,                       label: 'underage' },

  // ── Pregnancy / breastfeeding (most injectables contraindicated) ──
  { category: 'pregnancy', pattern: /\bpregnan(?:t|cy)\b/i,            label: 'pregnant' },
  { category: 'pregnancy', pattern: /\bbreastfeed(?:ing)?\b/i,         label: 'breastfeeding' },
  { category: 'pregnancy', pattern: /\bnursing\b/i,                    label: 'nursing' },
  { category: 'pregnancy', pattern: /\btrying\s+to\s+conceive\b/i,     label: 'trying to conceive' },
  { category: 'pregnancy', pattern: /\bttc\b/i,                        label: 'ttc' },
  { category: 'pregnancy', pattern: /\bivf\b/i,                        label: 'ivf' },
  { category: 'pregnancy', pattern: /\bexpecting\b/i,                  label: 'expecting' },

  // ── Medical contraindications ──
  { category: 'contraindication', pattern: /\bdiabet(?:es|ic)\b/i,     label: 'diabetes' },
  { category: 'contraindication', pattern: /\bblood\s*thinn(?:er|ers)\b/i, label: 'blood thinner' },
  { category: 'contraindication', pattern: /\b(?:warfarin|eliquis|xarelto|plavix)\b/i, label: 'anticoagulant' },
  { category: 'contraindication', pattern: /\b(?:accutane|isotretinoin)\b/i, label: 'accutane' },
  { category: 'contraindication', pattern: /\bautoimmune\b/i,          label: 'autoimmune' },
  { category: 'contraindication', pattern: /\blupus\b/i,               label: 'lupus' },
  { category: 'contraindication', pattern: /\bpacemaker\b/i,           label: 'pacemaker' },
  { category: 'contraindication', pattern: /\b(?:cancer|chemo(?:therapy)?)\b/i, label: 'cancer' },
  { category: 'contraindication', pattern: /\bimmunocompromised\b/i,   label: 'immunocompromised' },

  // ── Medical / adverse reactions / post-procedure clinical ──
  { category: 'medical', pattern: /\breaction\b/i,                     label: 'reaction' },
  { category: 'medical', pattern: /\ballerg(?:ic|y|ies)\b/i,           label: 'allergic' },
  { category: 'medical', pattern: /\bswelling\b/i,                     label: 'swelling' },
  { category: 'medical', pattern: /\bbruis(?:e|ed|ing)\b/i,            label: 'bruising' },
  { category: 'medical', pattern: /\bpain(?:ful)?\b/i,                 label: 'pain' },
  { category: 'medical', pattern: /\bhurt(?:s|ing)?\b/i,               label: 'hurts' },
  { category: 'medical', pattern: /\bbleed(?:ing)?\b/i,                label: 'bleeding' },
  { category: 'medical', pattern: /\binfect(?:ed|ion)\b/i,             label: 'infection' },
  { category: 'medical', pattern: /\b(?:emergency|hospital|er|urgent\s*care)\b/i, label: 'emergency' },
  { category: 'medical', pattern: /\b(?:doctor|physician|md|dr\.?)\b/i, label: 'doctor' },
  { category: 'medical', pattern: /\b(?:sick|nausea|nauseous|vomit(?:ing)?)\b/i, label: 'sick' },
  { category: 'medical', pattern: /\bnumb(?:ness)?\b/i,                label: 'numbness' },
  { category: 'medical', pattern: /\b(?:rash|hives|welts?)\b/i,        label: 'rash' },
  { category: 'medical', pattern: /\bdizz(?:y|iness)\b/i,              label: 'dizzy' },
  // Post-procedure clinical mentions
  { category: 'medical', pattern: /\b(?:lump|bump|knot|nodule|hard\s+spot)\b/i, label: 'lump' },
  { category: 'medical', pattern: /\bscab(?:s|bing)?\b/i,              label: 'scab' },
  { category: 'medical', pattern: /\bpeel(?:ing)?\b/i,                 label: 'peeling' },
  { category: 'medical', pattern: /\bitch(?:y|ing)?\b/i,               label: 'itchy' },
  { category: 'medical', pattern: /\bburn(?:ing)?\b/i,                 label: 'burning' },
  { category: 'medical', pattern: /\bside\s+effect/i,                  label: 'side effect' },
  { category: 'medical', pattern: /\b(?:cant?|can\s*not)\s+breathe\b/i, label: "can't breathe" },
  { category: 'medical', pattern: /\bchest\s+pain\b/i,                 label: 'chest pain' },

  // ── Complaints (incl. complaint-as-question patterns) ──
  { category: 'complaint', pattern: /\bcomplain(?:t|ing|ed)\b/i,       label: 'complaint' },
  { category: 'complaint', pattern: /\bunhappy\b/i,                    label: 'unhappy' },
  { category: 'complaint', pattern: /\bdisappoint(?:ed|ing|ment)\b/i,  label: 'disappointed' },
  { category: 'complaint', pattern: /\bangry\b/i,                      label: 'angry' },
  { category: 'complaint', pattern: /\bupset\b/i,                      label: 'upset' },
  { category: 'complaint', pattern: /\bworst\b/i,                      label: 'worst' },
  { category: 'complaint', pattern: /\b(?:terrible|horrible|awful)\b/i, label: 'terrible' },
  { category: 'complaint', pattern: /\bhate(?:d)?\b/i,                 label: 'hate' },
  { category: 'complaint', pattern: /\bnot\s+(?:happy|satisfied|impressed|ok(?:ay)?)\b/i, label: 'not happy' },
  { category: 'complaint', pattern: /\b(?:didn'?t|did\s+not|wasn'?t|was\s+not)\s+(?:like|enjoy|work|great|good)\b/i, label: "didn't work" },
  { category: 'complaint', pattern: /\b(?:never|not)\s+coming\s+back\b/i, label: 'not coming back' },
  { category: 'complaint', pattern: /\brude\b/i,                       label: 'rude' },
  { category: 'complaint', pattern: /\bunprofessional\b/i,             label: 'unprofessional' },
  { category: 'complaint', pattern: /\bfail(?:ed|ing|s)?\b/i,           label: 'failed' },
  { category: 'complaint', pattern: /\b(?:no|zero)\s+results?\b/i,     label: 'no results' },
  { category: 'complaint', pattern: /\bwore\s+off\b/i,                 label: 'wore off' },
  { category: 'complaint', pattern: /\b(?:isn'?t|is\s+not)\s+working\b/i, label: "isn't working" },
  { category: 'complaint', pattern: /\bmade\s+it\s+worse\b/i,          label: 'made it worse' },
  { category: 'complaint', pattern: /\b(?:looks?|looking)\s+(?:weird|wrong|worse|bad|off)\b/i, label: 'looks weird' },
  { category: 'complaint', pattern: /\b(?:doesn'?t|does\s+not)\s+look\s+right\b/i, label: "doesn't look right" },
  { category: 'complaint', pattern: /\b(?:asymmetric|uneven|lopsided|crooked)\b/i, label: 'uneven' },

  // ── Cancellations / refunds / reschedules ──
  { category: 'cancel', pattern: /\bcancel(?:ing|led|lation)?\b/i,     label: 'cancel' },
  { category: 'cancel', pattern: /\brefund\b/i,                        label: 'refund' },
  { category: 'cancel', pattern: /\bmoney\s+back\b/i,                  label: 'money back' },
  { category: 'cancel', pattern: /\bcan'?t\s+(?:make\s+it|come|be\s+there)\b/i, label: "can't make it" },
  { category: 'cancel', pattern: /\bnot\s+coming\b/i,                  label: 'not coming' },
  { category: 'cancel', pattern: /\breschedul(?:e|ing)\b/i,            label: 'reschedule' },
  { category: 'cancel', pattern: /\bpush\s+(?:it\s+)?back\b/i,         label: 'push back' },
  { category: 'cancel', pattern: /\b(?:move|change)\s+(?:it|my|the)\s+(?:to|appt|appointment)\b/i, label: 'move appt' },

  // ── Privacy / callback requests ──
  { category: 'privacy', pattern: /\b(?:call|phone)\s+me(?:\s+back)?\b/i, label: 'call me' },
  { category: 'privacy', pattern: /\b(?:in\s+)?private(?:ly)?\b/i,     label: 'private' },
  { category: 'privacy', pattern: /\bconfidential\b/i,                 label: 'confidential' },
  { category: 'privacy', pattern: /\bsensitive\b/i,                    label: 'sensitive' },

  // ── Cognitive / confusion ──
  { category: 'cognitive', pattern: /\b(?:dont|don'?t|cant|can'?t|do\s+not|can\s+not)\s+remember\b/i, label: "don't remember" },
  { category: 'cognitive', pattern: /\bwho\s+(?:is\s+this|are\s+you)\b/i, label: 'who is this' },
  { category: 'cognitive', pattern: /\bwhat\s+was\s+that\b/i,          label: 'what was that' },

  // ── Legal ──
  { category: 'legal', pattern: /\blawyer\b/i,                         label: 'lawyer' },
  { category: 'legal', pattern: /\battorney\b/i,                       label: 'attorney' },
  { category: 'legal', pattern: /\bsu(?:e|ing)\b/i,                    label: 'sue' },
  { category: 'legal', pattern: /\blawsuit\b/i,                        label: 'lawsuit' },
  { category: 'legal', pattern: /\bcourt\b/i,                          label: 'court' },

  // ── Escalation / public-review threats ──
  { category: 'escalation', pattern: /\bBBB\b/,                        label: 'BBB' },
  { category: 'escalation', pattern: /\byelp\b/i,                      label: 'yelp' },
  { category: 'escalation', pattern: /\bgoogle\s+review\b/i,           label: 'google review' },
  { category: 'escalation', pattern: /\b(?:fraud|scam)\b/i,            label: 'fraud' },
  { category: 'escalation', pattern: /\breport(?:ing)?\s+you\b/i,      label: 'reporting you' },

  // ── Financial distress ──
  { category: 'financial', pattern: /\bcan'?t\s+afford\b/i,            label: "can't afford" },
  { category: 'financial', pattern: /\blost\s+my\s+job\b/i,            label: 'lost my job' },

  // ── Urgency — narrow, only explicit time-critical signals ──
  { category: 'urgency', pattern: /\burgent\b/i,                       label: 'urgent' },
  { category: 'urgency', pattern: /\basap\b/i,                         label: 'asap' },
  { category: 'urgency', pattern: /\bemergenc(?:y|ies)\b/i,            label: 'emergency' },
  { category: 'urgency', pattern: /\bimmediately\b/i,                  label: 'immediately' },
  { category: 'urgency', pattern: /\bright\s+(?:now|away)\b/i,         label: 'right now' },
]

/**
 * Returns the FIRST matching safety rule's label, or null if no
 * safety trigger matched. Caller short-circuits autonomous send on
 * non-null results.
 *
 * Empty / whitespace-only bodies return the sentinel 'empty_body' —
 * never silently "safe". Belt-and-suspenders for any future caller
 * that doesn't pre-validate the inbound shape.
 */
export function safetyTrigger(body: string): string | null {
  if (!body || !body.trim()) return 'empty_body'
  for (const rule of SAFETY_RULES) {
    if (rule.pattern.test(body)) return rule.label
  }
  return null
}

// ─── Classification ───────────────────────────────────────────────

const CONFIRM_LEADING_RE =
  /^\s*(?:yes|yeah|yep|yup|sure|ok|okay|sounds\s+good|that\s+works|works\s+for\s+me|confirmed|i'?ll\s+be\s+there|see\s+you\s+(?:then|there))\b/i

const QUESTION_LEADING_RE =
  /^\s*(?:do|does|did|can|could|will|would|should|is|are|was|were|how|what|when|where|why|which|who)\b/i

// Words/phrases that, when present alongside a confirm leader, mean
// "but actually..." — flip the classification away from confirm.
const CONFIRM_NEGATION_RE =
  /\b(?:but|actually|wait|instead|change|move|push|different)\b/i

// Procedure / treatment keywords that indicate a substantive
// first-contact lead — should NOT be classified as a bare greeting.
const PROCEDURE_KEYWORD_RE =
  /\b(?:botox|filler|lip|laser|microneedl(?:e|ing)|hydrafacial|sculptra|kybella|emsculpt|coolsculpt|chemical\s+peel|prp|microblad|tox|dysport|jeuveau|juvederm|restylane|profhilo|ipl|peel|tox|consult|consultation|price|cost|how\s+much|pricing|booking|book(?:ing)?\s+(?:a|an|with))\b/i

const CONFIRM_WORD_CAP = 5

/**
 * Classify an inbound SMS body into one of the voice example
 * classes, or return 'unknown' for anything we can't confidently
 * pattern-match. 'unknown' is the safe default — caller MUST treat
 * it as ineligible for autonomous send.
 *
 * Order of checks matters:
 *   1. Empty body → 'unknown' (safety net for callers that didn't
 *      pre-validate).
 *   2. No clinic-outbound in history AND body is short + non-substantive
 *      → 'greeting'. Substantive first-contact (procedure keyword,
 *      question shape, >6 words) → 'unknown' (held for human review).
 *   3. Short confirm-shape reply WITHOUT negation modifiers
 *      → 'consult_confirm'.
 *   4. Question shape (leading wh-word or '?' with alpha content)
 *      → 'faq'.
 *   5. Otherwise → 'unknown'.
 *
 * 'follow_up' / 'follow_up_cold' / 'custom' are never returned for
 * inbound messages — those classes describe outbound staff intent.
 */
export function classifyInbound(
  body: string,
  history: Array<{ direction: 'inbound' | 'outbound' }>,
): ClassifierResult {
  if (!body || !body.trim()) return 'unknown'

  const trimmed = body.trim()
  const wordCount = trimmed.split(/\s+/).length
  const hasClinicReply = history.some(m => m.direction === 'outbound')

  // First contact: only emit 'greeting' when the body is bare —
  // a short hello with no substantive content. Anything that looks
  // like a product question, mentions a procedure, has a '?', or is
  // long → 'unknown' (held for review).
  if (!hasClinicReply) {
    const isSubstantive =
      wordCount > 6 ||
      PROCEDURE_KEYWORD_RE.test(trimmed) ||
      QUESTION_LEADING_RE.test(trimmed) ||
      /\?/.test(trimmed)
    return isSubstantive ? 'unknown' : 'greeting'
  }

  // Confirm-shape reply — short, leading-yes/ok, NO negation modifiers.
  if (wordCount <= CONFIRM_WORD_CAP &&
      CONFIRM_LEADING_RE.test(trimmed) &&
      !CONFIRM_NEGATION_RE.test(trimmed)) {
    return 'consult_confirm'
  }

  // Question shape — leading wh-word OR '?' but the body must
  // contain at least one alpha char (so bare "????" → unknown).
  if (/[a-z]/i.test(trimmed) &&
      (QUESTION_LEADING_RE.test(trimmed) || /\?/.test(trimmed))) {
    return 'faq'
  }

  return 'unknown'
}
