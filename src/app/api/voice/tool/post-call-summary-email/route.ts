/**
 * POST /api/voice/tool/post-call-summary-email — Phase 5.
 *
 * Called by Layla at call-end. Two side effects:
 *   1. INSERT activity_log row with action='voice_call_summary' and
 *      metadata={disposition, summary_text_sanitized, contact_resolved,
 *      call_sid}. The (potentially) PHI-bearing LLM prose lives ONLY
 *      in this row — owners read it inside the app, never over email.
 *   2. Fire-and-forget owner email via after(). The email body is
 *      strict PHI-free: 'Call completed: ${disposition} at ${org}.'
 *      summary_text is NEVER inlined.
 *
 * Defense-in-depth against PHI leak in the LLM-supplied summary:
 *   - Closed-enum disposition (no free-form on the most-emailed field).
 *   - summary_text length-capped at 280 chars.
 *   - Server-side regex strip of phone-number-shaped + US-date-shaped
 *     substrings before persisting to activity_log.
 *   - Even if a string slips through sanitization, it's still never
 *     surfaced to the email transport.
 *
 * Idempotency: keyed by call_sid. Same call_sid invoked twice within
 * 24h dedupes via Resend's Idempotency-Key + the activity_log row
 * lookup in the email helper. The activity_log INSERT itself is NOT
 * idempotency-gated here (the email helper is the user-visible
 * dedupe surface; double-INSERTing a summary row on a retry is
 * acceptable and visible to the owner).
 */

import { NextResponse, after } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { verifyVapiSignature } from '@/lib/voice-agent/verify-vapi-signature'
import { resolveCallEnvelope } from '@/lib/voice-agent/resolve-envelope'
import { toolCallFromVapiPayload, toolCallResponseForVapi } from '@/lib/voice-agent/tool-types'
import { normalizePhone } from '@/lib/validators'
import { notifyOwnerOfCallSummary, type CallDisposition } from '@/lib/voice/call-summary-notification'

const DISPOSITIONS: readonly CallDisposition[] = [
  'booked',
  'rescheduled',
  'canceled',
  'info_only',
  'message_taken',
  'transferred',
  'abandoned',
  'escalation_needed',
] as const

const SUMMARY_MAX_CHARS = 280

// Phone-number-shaped runs: 7+ consecutive digit groups separated by
// at most one of (space, dash, dot, paren). Catches "555-123-4567",
// "(555) 123 4567", "5551234567", "+1 555 123 4567". Conservative —
// will eat the occasional benign long number, which is the desired
// trade-off for a defense-in-depth PHI strip.
const PHONE_RE = /(?:\+?\d[\s().-]?){7,}\d/g

// US date shapes: M/D/YY, MM/DD/YYYY, M-D-YY, MM-DD-YYYY. We also
// strip ISO YYYY-MM-DD because that's the format the LLM would
// most easily echo from a tool result.
const US_DATE_RE = /\b(?:\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}|\d{4}-\d{1,2}-\d{1,2})\b/g

function sanitizeSummary(input: string): string {
  return input
    .slice(0, SUMMARY_MAX_CHARS)
    .replace(PHONE_RE, '[redacted]')
    .replace(US_DATE_RE, '[redacted]')
    .trim()
}

export async function POST(req: Request) {
  if (!verifyVapiSignature(req)) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const tc = toolCallFromVapiPayload(body)
  if (!tc) {
    return NextResponse.json({ error: 'unrecognized_payload_shape' }, { status: 400 })
  }

  // ── Args overrides for dashboard test calls. Production reads from
  // the call envelope. ──
  // Identity hard-locked to call envelope in prod; LLM-supplied
  // to_e164/from_e164/phone_number args refused outside dev.
  const { toE164 } = resolveCallEnvelope(tc)
  if (!toE164) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: false,
      error: 'Missing or unparseable to_e164',
    }))
  }

  // ── Validate LLM-supplied inputs. Closed enum + bounded string +
  // strict boolean — three of the four are tight by construction.
  // The free-form summary_text is the only field that gets the
  // regex-strip treatment below. ──
  const dispositionRaw = tc.arguments.disposition
  if (typeof dispositionRaw !== 'string' || !DISPOSITIONS.includes(dispositionRaw as CallDisposition)) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: false,
      error: `disposition must be one of: ${DISPOSITIONS.join(', ')}`,
    }))
  }
  const disposition = dispositionRaw as CallDisposition

  const summaryRaw = tc.arguments.summary_text
  if (typeof summaryRaw !== 'string') {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: false,
      error: 'summary_text is required and must be a string',
    }))
  }
  // Hard cap BEFORE sanitize so a multi-MB prompt-injection payload
  // never reaches the regex engine.
  const summaryTrimmed = summaryRaw.length > 500 ? summaryRaw.slice(0, 500) : summaryRaw
  const summarySanitized = sanitizeSummary(summaryTrimmed)

  const contactResolvedRaw = tc.arguments.contact_resolved
  if (typeof contactResolvedRaw !== 'boolean') {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: false,
      error: 'contact_resolved is required and must be a boolean',
    }))
  }
  const contactResolved = contactResolvedRaw

  // call_sid: prefer args override (dashboard test), else envelope.
  // We need a non-empty string for the idempotency key + deep link;
  // fall back to a synthetic key tagged with the toolCallId so the
  // INSERT still goes through and Resend has SOMETHING to dedupe on
  // (won't collide with a real sid because real sids start with 'CA').
  const argsCallSid = typeof tc.arguments.call_sid === 'string' ? tc.arguments.call_sid : undefined
  const rawCallSid = argsCallSid ?? tc.callSid ?? ''
  const callSid = rawCallSid && rawCallSid.length <= 64
    ? rawCallSid
    : `no_sid_${tc.toolCallId}`

  // ── Resolve org + agent-enabled gate. ──
  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('id, name, call_agent_enabled, call_agent_baa_attested_at')
    .eq('twilio_phone_number', toE164)
    .maybeSingle()
  if (!org) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: false,
      error: 'No clinic mapped to this number',
    }))
  }
  if (!org.call_agent_enabled || !org.call_agent_baa_attested_at) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: false,
      error: 'Voice agent is not enabled for this clinic',
    }))
  }

  // ── Persist the structured summary row. This is the ONLY surface
  // that retains the (sanitized) LLM prose — owners read it in-app. ──
  const { error: logErr } = await supabaseAdmin.from('activity_log').insert({
    organization_id: org.id,
    action:          'voice_call_summary',
    metadata: {
      disposition,
      summary_text_sanitized: summarySanitized,
      contact_resolved:       contactResolved,
      call_sid:               callSid,
    },
  })
  if (logErr) {
    // The activity_log insert is the durable artifact; if it fails
    // we want the LLM to know so it can retry. Email is opportunistic
    // and never gates this path.
    console.error('[voice/tool/post-call-summary-email] activity_log insert failed', logErr.message)
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: false,
      error: 'Failed to persist call summary',
    }))
  }

  // ── Fire-and-forget owner email. PHI-free body; never inlines
  // summary_text. Failures here are swallowed inside the helper. ──
  after(async () => {
    try {
      await notifyOwnerOfCallSummary({
        organizationId: org.id,
        callSid,
        disposition,
      })
    } catch (err) {
      console.error('[voice/tool/post-call-summary-email] owner notify threw', err)
    }
  })

  return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
    ok: true,
    output: {
      logged: true,
      disposition,
      call_sid: callSid,
    },
  }))
}
