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
 * Idempotency: keyed by call_sid. call_sid is REQUIRED — absence is
 * a real upstream bug (or a prompt-injected dashboard call) and we
 * fail loudly with missing_call_sid rather than fall back to a
 * synthetic key (the synthetic key would bypass both the Resend
 * idempotency window and the new partial UNIQUE index on
 * activity_log used by the owner-email dedupe in
 * notifyOwnerOfCallSummary, so a Vapi retry could fire two owner
 * emails for the same call). The activity_log voice_call_summary
 * INSERT itself is NOT idempotency-gated here — double-INSERTing
 * the structured summary row on a retry is acceptable; the
 * user-visible dedupe surface is the owner email helper.
 */

import { NextResponse, after } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { verifyVapiSignature } from '@/lib/voice-agent/verify-vapi-signature'
import { resolveCallEnvelope } from '@/lib/voice-agent/resolve-envelope'
import { sanitizeSummary } from '@/lib/voice-agent/sanitize-summary'
import { toolCallFromVapiPayload, toolCallResponseForVapi } from '@/lib/voice-agent/tool-types'
import { notifyOwnerOfCallSummary, type CallDisposition } from '@/lib/voice/call-summary-notification'
import { getVerticalConfig } from '@/lib/vertical/config'

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
  const { toE164 } = await resolveCallEnvelope(tc)
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
  // never reaches the regex engine. The scrub itself is gated on the
  // vertical below (medspa: on; others: off but available).
  const summaryTrimmed = summaryRaw.length > 500 ? summaryRaw.slice(0, 500) : summaryRaw

  // contact_resolved: accept native booleans plus stringified
  // "true"/"false" the LLM occasionally emits when it JSON-encodes
  // its tool-call args (same lenient coercion as find-service's
  // max_results, for the same reason). Anything else is a real
  // protocol error and we surface it back to the model.
  const contactResolvedRaw = tc.arguments.contact_resolved
  let contactResolved: boolean
  if (typeof contactResolvedRaw === 'boolean') {
    contactResolved = contactResolvedRaw
  } else if (typeof contactResolvedRaw === 'string') {
    const lowered = contactResolvedRaw.trim().toLowerCase()
    if (lowered === 'true') {
      contactResolved = true
    } else if (lowered === 'false') {
      contactResolved = false
    } else {
      return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
        ok: false,
        error: 'contact_resolved is required and must be a boolean',
      }))
    }
  } else {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: false,
      error: 'contact_resolved is required and must be a boolean',
    }))
  }

  // call_sid resolution. This is the call-END summary tool, so the
  // Vapi envelope MUST carry tc.callSid; absence is a real upstream
  // bug (or a prompt-injected dashboard call) and we want it to fail
  // loudly here rather than silently break downstream dedupe (the
  // activity_log partial UNIQUE index + Resend idempotency key are
  // both keyed on call_sid; a synthetic `no_sid_${toolCallId}`
  // fallback bypasses both, so a Vapi retry could fire two owner
  // emails for the same call).
  //
  // Args override is honored only outside production so the Vapi
  // dashboard's manual test harness can still exercise the route;
  // mirrors the resolveCallEnvelope() pattern.
  const allowSidOverride = process.env.NODE_ENV !== 'production'
  const argsCallSid = typeof tc.arguments.call_sid === 'string' ? tc.arguments.call_sid : undefined
  if (!allowSidOverride && argsCallSid) {
    // Don't log the full value — last 4 of whatever they tried to pass.
    console.warn('[voice/tool/post-call-summary-email] call_sid override attempted in prod (refused)', {
      envelope_call_sid_tail: tc.callSid ? tc.callSid.slice(-4) : undefined,
      arg_call_sid_tail:      argsCallSid.slice(-4),
    })
  }
  const rawCallSid = (allowSidOverride ? argsCallSid : undefined) ?? tc.callSid ?? ''
  if (!rawCallSid || rawCallSid.length > 64) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: false,
      error: 'missing_call_sid',
    }))
  }
  const callSid = rawCallSid

  // Multi-vertical Phase 2: the model reports the call's dominant
  // language on bilingual lines. Optional — English-only calls omit it.
  const dlRaw = tc.arguments.detected_language
  const detectedLanguage: 'en' | 'es' | null =
    dlRaw === 'en' || dlRaw === 'es' ? dlRaw : null

  // ── Resolve org + agent-enabled gate. ──
  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('id, name, vertical, call_agent_enabled, call_agent_baa_attested_at')
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

  // PHI scrub is on for med spas (covered entity) and off for the other
  // verticals (no PHI on a landscaping call). The sanitizer stays
  // available and is flipped per vertical in one place: config.phiScrub.
  const summaryStored = getVerticalConfig(org.vertical).phiScrub
    ? sanitizeSummary(summaryTrimmed)
    : summaryTrimmed

  // ── Persist the structured summary row. This is the ONLY surface
  // that retains the (sanitized) LLM prose — owners read it in-app. ──
  const { error: logErr } = await supabaseAdmin.from('activity_log').insert({
    organization_id: org.id,
    action:          'voice_call_summary',
    metadata: {
      disposition,
      summary_text_sanitized: summaryStored,
      contact_resolved:       contactResolved,
      call_sid:               callSid,
      detected_language:      detectedLanguage,
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
