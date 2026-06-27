/**
 * POST /api/voice/tool/take-message — Phase 5 W2.
 *
 * Caller dictates a message; Layla persists it on a voice_messages
 * row and fires a PHI-free owner notification email (deep link
 * only — no caller name, no phone, no message text in the email
 * body). The full content is surfaced ONLY in the in-app inbox.
 *
 * Why this tool:
 *   - Closes the "caller has a request Layla can't fully resolve"
 *     loop without a real-time human handoff.
 *   - Replaces a voicemail box for orgs that don't have one, and
 *     gives every owner an auditable inbox of every unresolved
 *     call.
 *
 * PHI handling:
 *   - caller_name + message_text are LLM-collected (the system
 *     prompt requires Layla to read the message back for caller
 *     confirmation before invoking this tool).
 *   - caller_phone is captured from the Twilio envelope
 *     (tc.fromE164) — NEVER from an LLM argument — so the LLM
 *     can't be persuaded to attribute a message to a different
 *     number.
 *   - Both are stored on the voice_messages row and surfaced only
 *     in the in-app inbox; the owner email is intentionally PHI-
 *     free per src/lib/booking/owner-notification.ts policy.
 *
 * Idempotency:
 *   - Owner notification keys on `voice_message_notify:${id}` so
 *     each distinct message fires exactly one email. Multiple
 *     messages from the same caller correctly produce multiple
 *     notifications (the dedupe is per row id, not per contact).
 */

import { NextResponse, after } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { verifyVapiSignature } from '@/lib/voice-agent/verify-vapi-signature'
import { resolveCallEnvelope } from '@/lib/voice-agent/resolve-envelope'
import { toolCallFromVapiPayload, toolCallResponseForVapi } from '@/lib/voice-agent/tool-types'
import { normalizePhone } from '@/lib/validators'
import { notifyOwnerOfVoiceMessage } from '@/lib/voice/message-notification'

// Closed enums — validated server-side regardless of what the LLM
// passes through. Defaults match the migration's column defaults.
const CALLBACK_PREFS = ['call', 'text', 'either'] as const
const URGENCIES = ['normal', 'urgent'] as const
type CallbackPref = (typeof CALLBACK_PREFS)[number]
type Urgency = (typeof URGENCIES)[number]

const MAX_NAME_LEN = 120
const MAX_MESSAGE_LEN = 2000

export async function POST(req: Request) {
  if (!verifyVapiSignature(req)) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const tc = toolCallFromVapiPayload(body)
  if (!tc) {
    return NextResponse.json({ error: 'unrecognized_payload_shape' }, { status: 400 })
  }

  // ── Validate caller-supplied inputs (LLM-collected). ──
  const rawCallerName = tc.arguments.caller_name
  const rawMessageText = tc.arguments.message_text
  const rawCallbackPref = tc.arguments.callback_preference
  const rawUrgency = tc.arguments.urgency

  if (typeof rawCallerName !== 'string' || rawCallerName.trim().length === 0) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: false,
      error: 'caller_name is required',
    }))
  }
  if (typeof rawMessageText !== 'string' || rawMessageText.trim().length === 0) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: false,
      error: 'message_text is required',
    }))
  }

  const callerName = rawCallerName.trim().slice(0, MAX_NAME_LEN)
  const messageText = rawMessageText.trim().slice(0, MAX_MESSAGE_LEN)

  const callbackPreference: CallbackPref =
    typeof rawCallbackPref === 'string' && (CALLBACK_PREFS as readonly string[]).includes(rawCallbackPref)
      ? (rawCallbackPref as CallbackPref)
      : 'either'

  const urgency: Urgency =
    typeof rawUrgency === 'string' && (URGENCIES as readonly string[]).includes(rawUrgency)
      ? (rawUrgency as Urgency)
      : 'normal'

  // ── Resolve org from the Twilio envelope (args overrides for
  // dashboard test calls, same pattern as the other tool routes).
  // caller_phone comes from the envelope, NEVER from an LLM arg —
  // we don't even read tc.arguments.caller_phone here. ──
  // Identity hard-locked to call envelope in prod; LLM-supplied
  // to_e164/from_e164/phone_number args refused outside dev.
  const { toE164, fromE164 } = resolveCallEnvelope(tc)

  // Tail-only logging — never log full caller IDs (PII).
  console.log('[voice/tool/take-message] envelope', {
    callSid: tc.callSid,
    toE164_tail: toE164?.slice(-4),
    fromE164_tail: fromE164?.slice(-4),
    urgency,
    callbackPreference,
    name_len: callerName.length,
    msg_len: messageText.length,
  })

  if (!toE164) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: false,
      error: 'Missing or unparseable to_e164',
    }))
  }

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

  // ── Best-effort contact resolution by caller ID. Same last-10-
  // digit ilike + JS exact-compare pattern as my-appointments /
  // cancel-appointment. A missing contact is normal (unknown
  // caller, new lead) — the message still gets stored. ──
  let contactId: string | null = null
  if (fromE164) {
    const last10 = fromE164.replace(/\D/g, '').slice(-10)
    if (last10.length === 10) {
      const { data: candidates } = await supabaseAdmin
        .from('contacts')
        .select('id, phone')
        .eq('organization_id', org.id)
        .eq('is_archived', false)
        .ilike('phone', `%${last10}`)
        .limit(5)
      const match = (candidates ?? []).find(
        c => (c.phone ?? '').replace(/\D/g, '').slice(-10) === last10,
      )
      contactId = match?.id ?? null
    }
  }

  // ── Idempotency: Vapi sometimes retries tool calls within the same
  // call_sid. Without a dedupe check the patient ends up with N copies
  // of their voicemail and the owner gets N notification emails.
  if (tc.callSid) {
    const { data: existing } = await supabaseAdmin
      .from('voice_messages')
      .select('id')
      .eq('organization_id', org.id)
      .eq('call_sid', tc.callSid)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (existing) {
      return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
        ok: true,
        output: { saved: true, voice_message_id: existing.id, deduped: true },
      }))
    }
  }

  // ── Persist the message. ──
  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from('voice_messages')
    .insert({
      organization_id:     org.id,
      contact_id:          contactId,
      caller_name:         callerName,
      caller_phone:        fromE164 || null,
      message_text:        messageText,
      urgency,
      callback_preference: callbackPreference,
      call_sid:            tc.callSid ?? null,
    })
    .select('id')
    .single()

  if (insertErr || !inserted) {
    console.error('[voice/take-message] insert failed', insertErr?.message)
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: false,
      error: 'Could not save the message — please try again or call back later',
    }))
  }

  const voiceMessageId = inserted.id

  // ── Audit row. Dedupe key on the route layer is voice_message_id
  // (NOT contact_id), so multiple legitimate messages from the same
  // caller each produce a distinct activity_log entry. ──
  after(async () => {
    try {
      await supabaseAdmin.from('activity_log').insert({
        organization_id: org.id,
        contact_id:      contactId,
        action:          'voice_message_taken',
        metadata: {
          voice_message_id: voiceMessageId,
          urgency,
          callback_preference: callbackPreference,
          // Tail only — full caller id is on the voice_messages row.
          from_e164_tail: fromE164?.slice(-4) ?? null,
          call_sid: tc.callSid ?? null,
        },
      })
    } catch {
      console.error('[voice/take-message activity_log] insert failed')
    }
  })

  // ── Fire-and-forget owner notification email (PHI-free body). ──
  after(async () => {
    try {
      await notifyOwnerOfVoiceMessage({
        organizationId: org.id,
        voiceMessageId,
        urgency,
      })
    } catch {
      console.error('[voice/take-message owner notification] failed')
    }
  })

  return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
    ok: true,
    output: {
      saved: true,
      voice_message_id: voiceMessageId,
      urgency,
      callback_preference: callbackPreference,
    },
  }))
}
