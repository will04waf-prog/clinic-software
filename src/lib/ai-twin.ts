/**
 * AI Front-Desk Twin — core draft generator and guardrails.
 *
 * Phase 1: persistent, human-approved drafts on every inbound SMS.
 * This module is the single source of truth for what the model is
 * told, what it's allowed to produce, and how the result is stored.
 *
 * Two entry points:
 *   - generateDraft(): produces a draft body + safety check.
 *     Called both by the existing /api/leads/[id]/draft-message
 *     (manual AI Draft button) and by the inbound auto-draft hook.
 *   - autoDraftForInbound(): the inbound-webhook side-effect that
 *     wraps generateDraft() in the ai_drafts persistence + dedup +
 *     activity log writes.
 *
 * The model is told it CANNOT do any of the following, and the
 * post-validation pass enforces the rules even if the model
 * disobeys:
 *   - quote dollar amounts
 *   - quote medical doses (units, ml, mg, syringes-by-size)
 *   - promise results ("you'll look", "will eliminate", "guaranteed")
 *   - name providers (we can't verify they're on staff)
 *   - commit to specific calendar slots
 */

import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { formatProcedure } from '@/lib/utils'
import { computeAvailableAfter } from '@/lib/quiet-hours'
import {
  readVoiceProfile,
  voiceProfileToPromptFragment,
  FALLBACK_CLASS_ORDER,
  VOICE_EXAMPLE_CLASSES,
  type VoiceExampleClass,
} from '@/lib/voice-profile'
import { classifyInbound, type ClassifierResult } from '@/lib/inbound-classifier'
import { attemptAutoSend } from '@/lib/auto-send'

// Phase 2 W7 — voice training tunables.
//
// MAX_VOICE_EXAMPLES caps how many past-message exemplars get
// injected into the system prompt. 3 keeps the SMS prompt under ~2KB
// even when each example is at the 400-char render cap. Most clinics
// will save 5-10 examples per class; we pick the newest by class +
// fallback walk so old examples don't pollute current voice.
const MAX_VOICE_EXAMPLES = 3
const MAX_EXAMPLE_BODY_CHARS = 400

const MODEL = 'claude-haiku-4-5'
const MAX_TOKENS = 300

// ─── Public types ──────────────────────────────────────────

export interface DraftContext {
  contactId: string
  organizationId: string
  channel: 'sms' | 'email'
  firstName: string
  procedureInterest: string[]
  source: string | null
  status: string | null
  daysSinceCreated: number
  daysSinceLastContact: number | null
  clinicName: string
  /** Up to 5, oldest first. */
  recentMessages: Array<{ direction: 'inbound' | 'outbound'; channel: string; body: string }>
  /** Inbound message that triggered this auto-draft. Null for manual invocations. */
  triggerMessageId: string | null
  /**
   * Phase 2 W7 — what KIND of message the twin is drafting. Drives
   * which voice_examples get pulled in as exemplars and what tone
   * fallbacks apply. Optional; defaults to 'faq' inside generateDraft
   * (the most common real-world case — patient asks, twin answers).
   */
  messageClass?: VoiceExampleClass
}

export type DraftResult =
  | {
      ok: true
      body: string
      subject?: string
      contextSnapshot: Record<string, unknown>
    }
  | {
      ok: false
      reason: 'empty' | 'guardrail_failed' | 'api_error'
      detail: string
      contextSnapshot?: Record<string, unknown>
      /** Which rule the guardrail caught, when reason === 'guardrail_failed'. */
      violation?: string
    }

// ─── Guardrail rules ───────────────────────────────────────

/**
 * Post-generation safety check. Returns { ok: true } or the rule
 * that the draft violated. ORDER MATTERS — most specific rules
 * first so we report the most useful violation reason.
 *
 * These rules MUST match the prohibitions in the system prompt;
 * the model usually obeys, the guardrails catch the cases where
 * it doesn't.
 *
 * W7: optional opts.bannedPhrases adds a per-org banned-phrase
 * check between profanity and too_long. Omitting opts preserves
 * exact W6 behavior. The phrase list is the owner's voice-profile
 * banned_phrases array — semantic matches (case-insensitive,
 * word-boundary where safe, substring fallback otherwise).
 */
export function checkGuardrails(
  body: string,
  opts?: { bannedPhrases?: string[] },
): { ok: true } | { ok: false; violation: string } {
  // Price quoting: $ followed by digits, "20 dollars", "20.00".
  // Kept first — it's the most specific and the highest-stakes rule
  // for med-spa compliance.
  if (/\$\s*\d/.test(body) || /\b\d{2,4}\s*(?:dollars|usd|bucks)\b/i.test(body)) {
    return { ok: false, violation: 'quoted_price' }
  }

  // Medical doses: "0.5ml", "20 units", "1 syringe", "2 mg".
  if (/\b\d+(?:\.\d+)?\s*(?:ml|mg|units?|syringes?|cc)\b/i.test(body)) {
    return { ok: false, violation: 'quoted_dose' }
  }

  // Medical advice — phrases that cross from front-desk into clinical
  // territory. Tightened from "you should/need to" (W4 ship) which
  // caught benign phrasing like "let us know when you should arrive."
  // Now matches only the clinical-advice shapes that immediately
  // follow with a medical/procedural verb. Plus the always-clinical
  // patterns like "stop taking" and "side effects of."
  const MEDICAL_ADVICE_PATTERNS = [
    // "you should take/avoid/use/apply/expect/feel/notice/experience…"
    /\byou\s+(?:should|need\s+to)\s+(?:take|avoid|use|apply|expect|feel|notice|experience|consult|see\s+a\s+doctor|stop|start|continue|increase|decrease)\b/i,
    /\bstop\s+taking\b/i,
    /\bside\s+effects?\s+of\b/i,
    /\bdosage\b/i,
    /\bprescrib(?:e|ed|ing)\b/i,
  ]
  for (const re of MEDICAL_ADVICE_PATTERNS) {
    if (re.test(body)) return { ok: false, violation: 'medical_advice' }
  }

  // Result promises — model gets explicit about outcomes.
  const PROMISE_PATTERNS = [
    /\byou(?:'ll| will)\s+look\b/i,
    /\bguaranteed?\b/i,
    /\bwill (?:eliminate|remove|erase|fix|cure)\b/i,
    /\b(?:zero|no) (?:pain|downtime|side\s*effects?)\b/i,
    /\byou\s+will\s+be\s+(?:cured|fixed|healed)\b/i,
  ]
  for (const re of PROMISE_PATTERNS) {
    if (re.test(body)) return { ok: false, violation: 'promised_outcome' }
  }

  // Provider name commitment — generic "Dr. X" / "with Dr. Y" pattern.
  if (/\bwith\s+dr\.?\s+[A-Z][a-z]+\b/.test(body)) {
    return { ok: false, violation: 'named_provider' }
  }

  // Calendar commitment — multiple shapes:
  //   "Thursday at 3pm", "tomorrow at 2"      (day-name + at + digit)
  //   "see you at 3pm", "see you at 11:30"    (greeting + time-like)
  //   "I'll book you in", "we'll see you"     (commitment phrasing)
  //   "scheduled you for"                     (already-booked phrasing)
  // The "see you at X" digit is constrained to a real time pattern
  // (1-12 with optional :MM or am/pm) so phrases like "see you at the
  // consultation" don't trip the rule.
  const CALENDAR_PATTERNS = [
    /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today)\s+at\s+\d/i,
    /\bsee\s+you\s+at\s+(?:1[0-2]|0?[1-9])(?::[0-5]\d)?\s*(?:am|pm)?\b/i,
    /\bi['’]?ll\s+book\b/i,
    /\bwe['’]?ll\s+see\s+you\b/i,
    /\bscheduled\s+you\s+for\b/i,
  ]
  for (const re of CALENDAR_PATTERNS) {
    if (re.test(body)) return { ok: false, violation: 'committed_calendar_slot' }
  }

  // Discount language.
  if (/\b\d+\s*%\s*(?:off|discount)\b/i.test(body) || /\bpromo\s*code\b/i.test(body)) {
    return { ok: false, violation: 'discount_offered' }
  }

  // Profanity — tight, English-only word list. Acceptable scope for
  // W4; revisit when we ship non-US clinics.
  const PROFANITY_RE = /\b(?:fuck|shit|asshole)\b/i
  if (PROFANITY_RE.test(body)) {
    return { ok: false, violation: 'profanity' }
  }

  // Per-org banned phrases (Phase 2 W7). Placed AFTER compliance
  // rules so a banned-phrase match doesn't preempt a price or
  // medical-advice violation. Word-boundary match when the phrase
  // is pure alphanumeric+spaces; substring includes() fallback for
  // phrases with apostrophes or punctuation ("y'all", "no problem!").
  if (opts?.bannedPhrases && opts.bannedPhrases.length > 0) {
    const lowerBody = body.toLowerCase()
    for (const phrase of opts.bannedPhrases) {
      const p = phrase.trim()
      if (!p) continue
      const lowerP = p.toLowerCase()
      if (/^[\w\s]+$/.test(p)) {
        const re = new RegExp(`\\b${escapeRegex(p)}\\b`, 'i')
        if (re.test(body)) return { ok: false, violation: 'banned_phrase' }
      } else if (lowerBody.includes(lowerP)) {
        return { ok: false, violation: 'banned_phrase' }
      }
    }
  }

  // Length cap — LAST, after all content rules, so a draft that
  // violates a content rule still reports the more useful reason.
  // 160 chars matches the SMS character budget the model is told to
  // hit; the disclosure footer is appended at send time.
  if (body.trim().length > 160) {
    return { ok: false, violation: 'too_long' }
  }

  return { ok: true }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ─── Disclosure footer ─────────────────────────────────────

/**
 * The mandatory AI-disclosure footer that gets appended to every
 * AI-drafted SMS the human sends (post-Send, not on the drafted
 * preview). Phase 1 compliance posture: every patient-facing
 * outbound that originated from an AI draft is labeled.
 *
 * The clinic name is appended at the end so the patient sees
 * "AI-assisted, reviewed by Lumière Aesthetics" rather than a
 * generic disclaimer.
 *
 * IMPORTANT: the footer is appended at send time (in send-sms
 * route), not embedded in the draft body the user reviews. This
 * keeps the model's character count honest — 160 chars of draft,
 * plus the footer the human can't edit.
 */
export function disclosureFooter(clinicName: string): string {
  return `\n— AI-assisted, reviewed by ${clinicName}`
}

// ─── Prompts ───────────────────────────────────────────────

const SMS_SYSTEM_PROMPT = `You write warm, professional follow-up SMS messages from a med spa or aesthetic clinic to a prospective patient.

Hard rules:
- Maximum 140 characters total (a disclosure footer is appended after you, so leave room).
- No emojis.
- No pushy sales language ("act now", "limited time", "don't miss out").
- Reference the contact's procedure interest naturally if one is provided.
- Include a soft call to action — offer to book a consultation or answer questions.
- NEVER quote a dollar amount, percentage discount, or promo code.
- NEVER quote a medical dose (units, ml, mg, syringes, cc).
- NEVER promise an outcome ("you'll look", "guaranteed", "will eliminate", "no pain", "zero downtime").
- NEVER name a specific provider (no "Dr. Smith", no "with our injector Maya").
- NEVER commit to a specific day-and-time slot ("Tuesday at 3pm"). You can offer a consultation but don't pick the time.
- Address the contact by first name.
- Do NOT add a signature — one will be appended.

Output ONLY the SMS body text. No preamble, no quotes, no labels.`

const EMAIL_SYSTEM_PROMPT = `You write warm, professional follow-up emails from a med spa or aesthetic clinic to a prospective patient.

Hard rules:
- First line is exactly: Subject: <subject line here>
- Then a blank line, then the email body.
- Email body is 3-4 short sentences, plain text only.
- No emojis.
- No pushy sales language.
- Reference the contact's procedure interest naturally if one is provided.
- Include a soft call to action — offer to book a consultation or answer questions.
- NEVER quote a dollar amount, percentage discount, or promo code.
- NEVER quote a medical dose (units, ml, mg, syringes, cc).
- NEVER promise an outcome.
- NEVER name a specific provider.
- NEVER commit to a specific day-and-time slot.
- Address the contact by first name.
- Sign off using the clinic name only.

Output ONLY the email in the format described. No preamble, no quotes, no commentary.`

function buildUserPrompt(ctx: DraftContext): string {
  const procedures = ctx.procedureInterest.map(formatProcedure).filter(Boolean)
  const lines: string[] = []
  lines.push(`Contact first name: ${ctx.firstName || 'there'}`)
  lines.push(`Procedure interest: ${procedures.length > 0 ? procedures.join(', ') : 'unspecified'}`)
  lines.push(`Lead source: ${ctx.source ?? 'unknown'}`)
  lines.push(`Lead status: ${ctx.status ?? 'lead'}`)
  lines.push(`Days since lead created: ${ctx.daysSinceCreated}`)
  lines.push(
    ctx.daysSinceLastContact !== null
      ? `Days since last contacted: ${ctx.daysSinceLastContact}`
      : `Last contacted: never`,
  )
  lines.push(`Clinic name: ${ctx.clinicName}`)

  if (ctx.recentMessages.length > 0) {
    lines.push('')
    lines.push('Recent message history (oldest first):')
    for (const m of ctx.recentMessages) {
      const dir = m.direction === 'outbound' ? 'We sent' : 'They sent'
      const ch = m.channel === 'sms' ? 'SMS' : 'email'
      const preview = (m.body ?? '').slice(0, 200).replace(/\s+/g, ' ')
      lines.push(`- ${dir} (${ch}): "${preview}${(m.body ?? '').length > 200 ? '…' : ''}"`)
    }
  }

  lines.push('')
  lines.push('Write the reply now. Output ONLY the message text, no preamble or commentary.')
  return lines.join('\n')
}

// ─── Draft generator ──────────────────────────────────────

/**
 * Produces a single draft. Network + guardrail concerns live here;
 * persistence concerns live in autoDraftForInbound() below or in
 * the manual-invocation route.
 *
 * Retries once with stronger constraints on guardrail failure. If
 * the retry also fails, returns the violation so the caller can
 * persist a `guardrail_failed` row (Phase 1 surfaces this in
 * activity_log; Phase 2 will retrain on these cases).
 */
export async function generateDraft(ctx: DraftContext): Promise<DraftResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, reason: 'api_error', detail: 'ANTHROPIC_API_KEY missing' }
  }

  // Defensive class resolution — if a future caller (or a JSON
  // boundary cast) passes a string not in the enum, fall back to
  // 'faq'. Prevents a TypeError when FALLBACK_CLASS_ORDER[bad] is
  // undefined inside the for-of in selectVoiceExamples.
  const requested = ctx.messageClass
  const resolvedClass: VoiceExampleClass =
    requested && (VOICE_EXAMPLE_CLASSES as readonly string[]).includes(requested)
      ? requested
      : 'faq'

  // Fetch voice profile + the org's top-30 examples in parallel.
  // Selection (class match + fallback) happens in-process from the
  // 30-row window — keeps the hot path to one round-trip when the
  // exact class has zero matches and the fallback walk needs to see
  // every class. limit(30) matches the org-level soft cap enforced
  // by the API on insert.
  //
  // Either query failing → degrade gracefully to defaults (no voice
  // applied). The warning logs let an outage on voice_examples show
  // up in observability instead of silently reverting every org.
  const [orgRes, examplesRes] = await Promise.all([
    supabaseAdmin
      .from('organizations')
      .select('ai_twin_voice_profile')
      .eq('id', ctx.organizationId)
      .single(),
    supabaseAdmin
      .from('voice_examples')
      .select('id, class, label, body, created_at')
      .eq('organization_id', ctx.organizationId)
      .order('created_at', { ascending: false })
      .limit(30),
  ])
  if (orgRes.error)      console.warn('[ai-twin] voice profile fetch failed:',  ctx.organizationId, orgRes.error.message)
  if (examplesRes.error) console.warn('[ai-twin] voice examples fetch failed:', ctx.organizationId, examplesRes.error.message)

  const profile = readVoiceProfile(orgRes.data?.ai_twin_voice_profile ?? {})
  const voiceFragment = voiceProfileToPromptFragment(profile)
  // Email examples are deferred — saved exemplars are SMS-flavored
  // (short, fragmented) and pushing the model toward that shape
  // conflicts with the email prompt's 3-4-sentence rule. Skip until
  // a future migration adds a `channel` column on voice_examples.
  const selectedExamples = ctx.channel === 'sms'
    ? selectVoiceExamples(examplesRes.data ?? [], resolvedClass)
    : []
  const examplesBlock = renderVoiceExamplesBlock(selectedExamples)

  const baseSystemPrompt = ctx.channel === 'sms' ? SMS_SYSTEM_PROMPT : EMAIL_SYSTEM_PROMPT
  // Both fragment and examples-block supply their own leading
  // whitespace (or empty string) — direct concatenation produces a
  // byte-identical W6 prompt when profile is all-defaults AND
  // examples is empty.
  const systemPrompt = baseSystemPrompt + voiceFragment + examplesBlock
  const userPrompt = buildUserPrompt(ctx)

  const client = new Anthropic()

  const contextSnapshot: Record<string, unknown> = {
    channel: ctx.channel,
    procedures: ctx.procedureInterest,
    source: ctx.source,
    status: ctx.status,
    days_since_created: ctx.daysSinceCreated,
    days_since_last_contact: ctx.daysSinceLastContact,
    recent_messages_count: ctx.recentMessages.length,
    trigger_message_id: ctx.triggerMessageId,
    model: MODEL,
    // ── W7 voice metadata ──────────────────────────────────────
    // Snapshot the voice signals at draft time so W8 edit-pattern
    // analysis can correlate edit_distance with voice settings even
    // after the org tweaks them later.
    voice_class: resolvedClass,
    voice_examples_used: selectedExamples.length,
    voice_example_classes_used: selectedExamples.map(e => e.class),
    voice_profile_active: voiceFragment.length > 0,
    voice_applied: voiceFragment.length > 0 || selectedExamples.length > 0,
    voice_banned_phrases_count: profile.banned_phrases.length,
    voice_tone_formal: profile.tone_formal,
    voice_tone_warm: profile.tone_warm,
  }

  async function callOnce(extraNudge?: string): Promise<{ raw: string } | { error: string }> {
    try {
      const res = await client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: extraNudge ? `${systemPrompt}\n\nCRITICAL: ${extraNudge}` : systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      })
      const block = res.content.find(b => b.type === 'text')
      const raw = block && block.type === 'text' ? block.text.trim() : ''
      if (!raw) return { error: 'empty' }
      return { raw }
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'api_error' }
    }
  }

  const guardrailOpts = { bannedPhrases: profile.banned_phrases }

  // First attempt.
  const first = await callOnce()
  if ('error' in first) {
    if (first.error === 'empty') return { ok: false, reason: 'empty', detail: 'Empty model response', contextSnapshot }
    return { ok: false, reason: 'api_error', detail: first.error, contextSnapshot }
  }

  const { body: firstBody, subject: firstSubject } = ctx.channel === 'email' ? splitEmailDraft(first.raw) : { body: first.raw, subject: undefined }
  // Email subjects often carry marketing-y rule violations (prices,
  // discounts, promised outcomes). Run guardrails on subject+body
  // for email so the subject can't slip a violation through. SMS
  // has no subject.
  const firstCheckTarget = ctx.channel === 'email' && firstSubject
    ? `${firstSubject}\n${firstBody}`
    : firstBody
  const firstCheck = checkGuardrails(firstCheckTarget, guardrailOpts)
  if (firstCheck.ok) {
    return { ok: true, body: firstBody, subject: firstSubject, contextSnapshot }
  }

  // Retry once with an explicit nudge about the rule that broke.
  const nudge = guardrailNudge(firstCheck.violation)
  const retry = await callOnce(nudge)
  if ('error' in retry) {
    // Retry call itself failed (network blip, rate limit, empty
    // response). Don't mislabel as guardrail_failed — that's a
    // content judgment, this was an infra failure.
    if (retry.error === 'empty') {
      return { ok: false, reason: 'empty', detail: 'Retry returned empty', contextSnapshot }
    }
    return { ok: false, reason: 'api_error', detail: retry.error, contextSnapshot }
  }
  const { body: retryBody, subject: retrySubject } = ctx.channel === 'email' ? splitEmailDraft(retry.raw) : { body: retry.raw, subject: undefined }
  const retryCheckTarget = ctx.channel === 'email' && retrySubject
    ? `${retrySubject}\n${retryBody}`
    : retryBody
  const retryCheck = checkGuardrails(retryCheckTarget, guardrailOpts)
  if (retryCheck.ok) {
    return { ok: true, body: retryBody, subject: retrySubject, contextSnapshot }
  }

  // Both attempts failed. Caller persists guardrail_failed row.
  return {
    ok: false,
    reason: 'guardrail_failed',
    detail: retryCheck.violation,
    violation: retryCheck.violation,
    contextSnapshot,
  }
}

// ─── Voice example selection + rendering ───────────────────

interface VoiceExampleRow {
  id: string
  class: VoiceExampleClass
  label: string | null
  body: string
  created_at: string
}

/**
 * Pick up to MAX_VOICE_EXAMPLES exemplars from the org's saved rows,
 * preferring exact-class matches and walking FALLBACK_CLASS_ORDER
 * when fewer than the budget exist. Rows must arrive sorted newest
 * first (the caller's query does this).
 *
 * 'custom' is never used as a fallback target — semantics are
 * undefined. If the requested class is 'custom', we still fall back
 * to faq/follow_up to fill the budget.
 */
function selectVoiceExamples(
  rows: ReadonlyArray<VoiceExampleRow>,
  requestedClass: VoiceExampleClass,
): VoiceExampleRow[] {
  if (rows.length === 0) return []

  const exact = rows.filter(r => r.class === requestedClass).slice(0, MAX_VOICE_EXAMPLES)
  if (exact.length >= MAX_VOICE_EXAMPLES) return exact

  // Dedup by row id — robust to identical body text saved under
  // multiple classes (cheaper + safer than the class+body string).
  const picked: VoiceExampleRow[] = [...exact]
  const taken = new Set(picked.map(p => p.id))
  for (const cls of FALLBACK_CLASS_ORDER[requestedClass]) {
    if (picked.length >= MAX_VOICE_EXAMPLES) break
    for (const r of rows) {
      if (picked.length >= MAX_VOICE_EXAMPLES) break
      if (r.class !== cls) continue
      if (taken.has(r.id)) continue
      picked.push(r)
      taken.add(r.id)
    }
  }
  return picked
}

/**
 * Renders the <voice_examples> block injected into the system
 * prompt. Returns '' when there are no examples — so the W6/W7
 * prompts are byte-identical for orgs with empty voice training.
 *
 * XML tags chosen over multi-turn assistant messages because the
 * latter would pollute the recent-message slice the user prompt
 * already shows, and risk the model interleaving exemplars with
 * real conversation history.
 *
 * Each example body is truncated at MAX_EXAMPLE_BODY_CHARS to keep
 * the prompt budget in check — the 600-char DB cap is generous for
 * UI but oversized for prompt context.
 */
function renderVoiceExamplesBlock(examples: VoiceExampleRow[]): string {
  if (examples.length === 0) return ''
  const lines: string[] = []
  lines.push('')
  lines.push('')
  lines.push('<voice_examples>')
  lines.push('The following are real past replies from this clinic. Match their tone, phrasing, and structure. Do not copy verbatim — adapt to the current contact.')
  for (const ex of examples) {
    const label = ex.label ? ` label="${escapeXml(ex.label)}"` : ''
    // Truncate first, then XML-escape. Escape protects against a
    // clinic owner pasting "</example></voice_examples><system>..."
    // into a saved example body — without escaping the model would
    // see a closed examples block followed by what reads as a new
    // system instruction.
    const truncated = ex.body.length > MAX_EXAMPLE_BODY_CHARS
      ? ex.body.slice(0, MAX_EXAMPLE_BODY_CHARS) + '…'
      : ex.body
    lines.push('')
    lines.push(`<example class="${ex.class}"${label}>`)
    lines.push(escapeXml(truncated))
    lines.push('</example>')
  }
  lines.push('</voice_examples>')
  return lines.join('\n')
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}


function guardrailNudge(violation: string): string {
  switch (violation) {
    case 'quoted_price':           return 'Do NOT include any dollar amount, price, or discount.'
    case 'quoted_dose':            return 'Do NOT mention units, ml, mg, or syringes.'
    case 'medical_advice':         return 'Do NOT give medical advice. Avoid "you should", "stop taking", or describing side effects.'
    case 'promised_outcome':       return 'Do NOT promise outcomes. No "you\'ll look", no "guaranteed".'
    case 'named_provider':         return 'Do NOT name a specific provider.'
    case 'committed_calendar_slot':return 'Do NOT commit to a specific day-and-time slot or say you have booked the patient.'
    case 'discount_offered':       return 'Do NOT offer a discount or promo code.'
    case 'profanity':              return 'Do NOT use profanity. Stay professional.'
    case 'banned_phrase':          return 'Do NOT use the clinic\'s forbidden phrases. Re-read the voice rules above.'
    case 'too_long':               return 'Your reply was too long. Keep it under 160 characters.'
    default:                       return 'Re-read the hard rules and stay strictly within them.'
  }
}

function splitEmailDraft(raw: string): { subject: string; body: string } {
  const lines = raw.split('\n')
  const firstLine = lines[0]?.trim() ?? ''
  const subjectMatch = firstLine.match(/^subject\s*:\s*(.+)$/i)
  if (subjectMatch) {
    return {
      subject: subjectMatch[1].trim(),
      body: lines.slice(1).join('\n').replace(/^\s+/, '').trim(),
    }
  }
  return { subject: '', body: raw }
}

// ─── Auto-draft-on-inbound side effect ─────────────────────

/**
 * Called fire-and-forget from the Twilio inbound webhook after a
 * 'received' message row is persisted. Generates an AI reply
 * suggestion and stores it in ai_drafts so the inbox can show it.
 *
 * Best-effort: a failure here NEVER blocks the webhook. Errors are
 * logged but swallowed.
 */
export async function autoDraftForInbound(args: {
  organizationId: string
  contactId: string
  triggerMessageId: string
  /** Raw inbound body — required for classifier + safety triggers. */
  inboundBody: string
}): Promise<void> {
  try {
    // Idempotency: don't create a second draft if one already exists
    // for this trigger. Includes pending + auto_sent so the
    // autonomous send path can't double-fire on a webhook retry.
    const { data: existing } = await supabaseAdmin
      .from('ai_drafts')
      .select('id, state')
      .eq('trigger_message_id', args.triggerMessageId)
      .in('state', ['pending', 'auto_sent'])
      .maybeSingle()
    if (existing) return

    // Hydrate context. Pull the AI Twin org-level controls in the same
    // round-trip so we don't need a second SELECT after deciding to
    // proceed.
    const [{ data: contact }, { data: org }, { data: history }] = await Promise.all([
      supabaseAdmin
        .from('contacts_active')
        .select('id, first_name, phone, procedure_interest, source, status, created_at, last_contacted_at, sms_consent, opted_out_sms')
        .eq('id', args.contactId)
        .eq('organization_id', args.organizationId)
        .single(),
      supabaseAdmin
        .from('organizations')
        .select('name, timezone, ai_twin_enabled, ai_twin_quiet_hours_start, ai_twin_quiet_hours_end, ai_twin_auto_send_enabled, ai_twin_auto_send_classes')
        .eq('id', args.organizationId)
        .single(),
      supabaseAdmin
        .from('messages')
        .select('channel, direction, body, created_at')
        .eq('contact_id', args.contactId)
        .eq('organization_id', args.organizationId)
        .order('created_at', { ascending: false })
        .limit(5),
    ])

    if (!contact) {
      console.warn('[ai-twin] autoDraft: contact not found', args.contactId)
      return
    }

    // Master switch: silently skip when the org has disabled the AI
    // Twin. We don't write a row and we don't log activity — the
    // owner asked for silence.
    if (org && org.ai_twin_enabled === false) {
      return
    }

    // Don't bother drafting if we can't send anyway.
    if (contact.opted_out_sms) {
      console.info('[ai-twin] autoDraft: contact opted out, skipping')
      return
    }

    const recentMessages = ((history ?? []) as Array<{ channel: string; direction: 'inbound' | 'outbound'; body: string }>)
      .reverse()
      .map(m => ({ channel: m.channel, direction: m.direction, body: m.body }))

    // W9 — classify the inbound up front. The classifier output may
    // be 'unknown', in which case we still generate a draft (using
    // 'faq' as the prompt class for example selection) but never
    // qualify for auto-send.
    const classified: ClassifierResult = classifyInbound(args.inboundBody, recentMessages)
    const promptClass: VoiceExampleClass = classified === 'unknown' ? 'faq' : classified

    const ctx: DraftContext = {
      contactId: args.contactId,
      organizationId: args.organizationId,
      channel: 'sms',
      firstName: contact.first_name ?? 'there',
      procedureInterest: (contact.procedure_interest as string[] | null) ?? [],
      source: (contact.source as string | null) ?? null,
      status: (contact.status as string | null) ?? null,
      daysSinceCreated: daysSince(contact.created_at as string),
      daysSinceLastContact: contact.last_contacted_at
        ? daysSince(contact.last_contacted_at as string)
        : null,
      clinicName: org?.name ?? 'our clinic',
      recentMessages,
      triggerMessageId: args.triggerMessageId,
      messageClass: promptClass,
    }

    const result = await generateDraft(ctx)

    if (!result.ok) {
      // Persist guardrail failure for analysis; skip api/empty errors silently.
      if (result.reason === 'guardrail_failed') {
        await supabaseAdmin.from('ai_drafts').insert({
          organization_id:    args.organizationId,
          contact_id:         args.contactId,
          channel:            'sms',
          trigger_message_id: args.triggerMessageId,
          draft_body:         '',
          model:              MODEL,
          context_snapshot:   result.contextSnapshot,
          state:              'guardrail_failed',
          guardrail_violation:result.violation ?? null,
          resolved_at:        new Date().toISOString(),
        })
      }
      console.warn('[ai-twin] autoDraft failed:', result.reason, result.detail)
      return
    }

    // Quiet hours: if we're inside the org's configured window, defer
    // making this draft visible to the inbox until the window closes.
    // The draft itself is still generated and persisted so the model
    // context is fresh; only the read path hides it.
    const availableAfter = computeAvailableAfter(
      new Date(),
      org?.timezone ?? null,
      (org?.ai_twin_quiet_hours_start as string | null) ?? null,
      (org?.ai_twin_quiet_hours_end as string | null) ?? null,
    )
    const isInQuietHours = availableAfter !== null

    // Persist the raw classifier verdict alongside the prompt class
    // so W8 metrics can distinguish "model said 'unknown', we forced
    // 'faq'" from "classifier returned faq directly". The prompt
    // class drives example selection; the classified value is the
    // source of truth for the inbound's actual intent.
    const contextSnapshotWithClass = {
      ...result.contextSnapshot,
      classified_class: classified,
    }

    // ── W9: pre-claim the trigger as a pending draft. ──
    // The unique partial index on (trigger_message_id) WHERE state
    // ='pending' is our mutex. Two concurrent webhooks (retry, race)
    // serialize here — only the winning insert proceeds to Twilio.
    // The loser exits silently.
    const { data: draftRow, error: claimErr } = await supabaseAdmin
      .from('ai_drafts')
      .insert({
        organization_id:    args.organizationId,
        contact_id:         args.contactId,
        channel:            'sms',
        trigger_message_id: args.triggerMessageId,
        draft_body:         result.body,
        model:              MODEL,
        context_snapshot:   contextSnapshotWithClass,
        state:              'pending',
        available_after:    availableAfter,
      })
      .select('id')
      .single()

    if (claimErr || !draftRow) {
      // 23505 = duplicate trigger (concurrent invocation won the
      // race). Other errors logged and bailed; the next call/retry
      // can pick it up.
      if (claimErr && (claimErr as { code?: string }).code === '23505') {
        console.info('[ai-twin] another instance claimed this trigger; exiting')
      } else {
        console.error('[ai-twin] pending ai_drafts pre-claim failed:', claimErr)
      }
      return
    }

    // ── W9: attempt autonomous send. ──
    // Refuses by default. attemptAutoSend transitions the pre-claimed
    // pending row to 'auto_sent' on success; on refusal/failure the
    // row stays 'pending' for the human to handle (no double-send).
    const autoSendOutcome = await attemptAutoSend({
      organizationId:     args.organizationId,
      contactId:          args.contactId,
      contactPhone:       (contact.phone as string | null) ?? null,
      contactSmsConsent:  contact.sms_consent === true,
      contactOptedOut:    contact.opted_out_sms === true,
      clinicName:         org?.name ?? 'our clinic',
      orgAutoSendEnabled: (org?.ai_twin_auto_send_enabled as boolean | null) === true,
      orgAutoSendClasses: ((org?.ai_twin_auto_send_classes as string[] | null) ?? []),
      isInQuietHours,
      triggerMessageId:   args.triggerMessageId,
      messageClass:       classified,
      inboundBody:        args.inboundBody,
      draftBody:          result.body,
      disclosureFooter:   disclosureFooter(org?.name ?? 'our clinic'),
      model:              MODEL,
      draftRowId:         draftRow.id,
    })

    if (autoSendOutcome.ok) {
      console.info('[ai-twin] auto-sent', { orgId: args.organizationId, contactId: args.contactId, messageId: autoSendOutcome.messageId, class: classified })
      return
    }

    console.info('[ai-twin] auto-send skipped — pending draft retained', { orgId: args.organizationId, contactId: args.contactId, reason_code: autoSendOutcome.reason_code })

    // Activity log for the human-review pending draft. The
    // pre-claimed row already lives in ai_drafts(state='pending').
    await supabaseAdmin.from('activity_log').insert({
      organization_id: args.organizationId,
      contact_id:      args.contactId,
      action:          'ai_draft_generated',
      metadata: {
        channel: 'sms',
        model: MODEL,
        trigger: 'inbound_auto',
        trigger_message_id: args.triggerMessageId,
        message_class: classified,
        auto_send_skipped_reason: autoSendOutcome.reason_code,
      },
    })
  } catch (err) {
    console.error('[ai-twin] autoDraftForInbound unexpected error:', err)
  }
}

function daysSince(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime()
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)))
}
