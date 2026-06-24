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
 */
export function checkGuardrails(body: string): { ok: true } | { ok: false; violation: string } {
  const text = body.toLowerCase()

  // Price quoting: $ followed by digits, "20 dollars", "20.00"
  if (/\$\s*\d/.test(body) || /\b\d{2,4}\s*(?:dollars|usd|bucks)\b/i.test(body)) {
    return { ok: false, violation: 'quoted_price' }
  }

  // Medical doses: "0.5ml", "20 units", "1 syringe", "2 mg"
  if (/\b\d+(?:\.\d+)?\s*(?:ml|mg|units?|syringes?|cc)\b/i.test(body)) {
    return { ok: false, violation: 'quoted_dose' }
  }

  // Result promises — model gets explicit about outcomes
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

  // Provider name commitment — generic "Dr. X" / "with Dr. Y" pattern
  if (/\bwith\s+dr\.?\s+[A-Z][a-z]+\b/.test(body)) {
    return { ok: false, violation: 'named_provider' }
  }

  // Calendar commitment — "Thursday at 3pm", "tomorrow at 2"
  if (/\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today)\s+at\s+\d/i.test(body)) {
    return { ok: false, violation: 'committed_calendar_slot' }
  }

  // Discount language
  if (/\b\d+\s*%\s*(?:off|discount)\b/i.test(body) || /\bpromo\s*code\b/i.test(body)) {
    return { ok: false, violation: 'discount_offered' }
  }

  return { ok: true }
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

  const client = new Anthropic()
  const systemPrompt = ctx.channel === 'sms' ? SMS_SYSTEM_PROMPT : EMAIL_SYSTEM_PROMPT
  const userPrompt = buildUserPrompt(ctx)

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

  // First attempt.
  const first = await callOnce()
  if ('error' in first) {
    if (first.error === 'empty') return { ok: false, reason: 'empty', detail: 'Empty model response', contextSnapshot }
    return { ok: false, reason: 'api_error', detail: first.error, contextSnapshot }
  }

  const { body: firstBody, subject: firstSubject } = ctx.channel === 'email' ? splitEmailDraft(first.raw) : { body: first.raw, subject: undefined }
  const firstCheck = checkGuardrails(firstBody)
  if (firstCheck.ok) {
    return { ok: true, body: firstBody, subject: firstSubject, contextSnapshot }
  }

  // Retry once with an explicit nudge about the rule that broke.
  const nudge = guardrailNudge(firstCheck.violation)
  const retry = await callOnce(nudge)
  if ('error' in retry) {
    return { ok: false, reason: 'guardrail_failed', detail: firstCheck.violation, violation: firstCheck.violation, contextSnapshot }
  }
  const { body: retryBody, subject: retrySubject } = ctx.channel === 'email' ? splitEmailDraft(retry.raw) : { body: retry.raw, subject: undefined }
  const retryCheck = checkGuardrails(retryBody)
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

function guardrailNudge(violation: string): string {
  switch (violation) {
    case 'quoted_price':           return 'Do NOT include any dollar amount, price, or discount.'
    case 'quoted_dose':            return 'Do NOT mention units, ml, mg, or syringes.'
    case 'promised_outcome':       return 'Do NOT promise outcomes. No "you\'ll look", no "guaranteed".'
    case 'named_provider':         return 'Do NOT name a specific provider.'
    case 'committed_calendar_slot':return 'Do NOT commit to a specific day-and-time slot.'
    case 'discount_offered':       return 'Do NOT offer a discount or promo code.'
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
}): Promise<void> {
  try {
    // Idempotency: don't create a second draft if one already exists
    // for this trigger. The unique partial index also enforces this
    // at the DB level — this just avoids the API call.
    const { data: existing } = await supabaseAdmin
      .from('ai_drafts')
      .select('id')
      .eq('trigger_message_id', args.triggerMessageId)
      .eq('state', 'pending')
      .maybeSingle()
    if (existing) return

    // Hydrate context.
    const [{ data: contact }, { data: org }, { data: history }] = await Promise.all([
      supabaseAdmin
        .from('contacts_active')
        .select('id, first_name, procedure_interest, source, status, created_at, last_contacted_at, sms_consent, opted_out_sms')
        .eq('id', args.contactId)
        .eq('organization_id', args.organizationId)
        .single(),
      supabaseAdmin
        .from('organizations')
        .select('name')
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

    // Don't bother drafting if we can't send anyway.
    if (contact.opted_out_sms) {
      console.info('[ai-twin] autoDraft: contact opted out, skipping')
      return
    }

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
      recentMessages: ((history ?? []) as Array<{ channel: string; direction: 'inbound' | 'outbound'; body: string }>)
        .reverse()
        .map(m => ({ channel: m.channel, direction: m.direction, body: m.body })),
      triggerMessageId: args.triggerMessageId,
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

    await supabaseAdmin.from('ai_drafts').insert({
      organization_id:    args.organizationId,
      contact_id:         args.contactId,
      channel:            'sms',
      trigger_message_id: args.triggerMessageId,
      draft_body:         result.body,
      model:              MODEL,
      context_snapshot:   result.contextSnapshot,
      state:              'pending',
    })

    await supabaseAdmin.from('activity_log').insert({
      organization_id: args.organizationId,
      contact_id:      args.contactId,
      action:          'ai_draft_generated',
      metadata: {
        channel: 'sms',
        model: MODEL,
        trigger: 'inbound_auto',
        trigger_message_id: args.triggerMessageId,
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
