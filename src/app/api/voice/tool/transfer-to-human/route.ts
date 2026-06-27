/**
 * POST /api/voice/tool/transfer-to-human — Phase 5 W1 extension.
 *
 * Honest-autonomy ceiling tool: Layla calls this when she determines
 * she can't help (clinical question, complaint, billing dispute, or
 * the caller explicitly asks for a human). The destination phone
 * number is read SERVER-SIDE from `organizations.call_agent_fallback_e164`
 * — the LLM never gets to name a transfer target, so a prompt-
 * injection attempt cannot redirect the call.
 *
 * Behavior:
 *   - If the org has a fallback number AND we're inside configured
 *     business hours (or no business hours are configured at all):
 *       → return { transferred:true, transfer_destination } so the
 *         Vapi/Twilio bridge can dial it.
 *   - If the fallback is unset OR we're out of configured business
 *     hours:
 *       → return { transferred:false, reason:'fallback_unavailable' }.
 *         The receptionist prompt instructs Layla to pivot to
 *         `take_message` immediately in this branch so the caller is
 *         never stranded.
 *
 * Audit: every attempt (success or downgrade) writes an `activity_log`
 * row with action='voice_transferred' and only the LAST 4 of the
 * caller's number — never the full E.164.
 *
 * PHI policy: `summary` lives in activity_log.metadata only and never
 * in any email body. The prompt is responsible for keeping summary
 * non-clinical; the route enforces a 280-char cap as a backstop.
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { verifyVapiSignature } from '@/lib/voice-agent/verify-vapi-signature'
import { resolveCallEnvelope } from '@/lib/voice-agent/resolve-envelope'
import { toolCallFromVapiPayload, toolCallResponseForVapi } from '@/lib/voice-agent/tool-types'
import { normalizePhone } from '@/lib/validators'

const REASON_ENUM = [
  'clinical_question',
  'complaint',
  'billing_dispute',
  'staff_request',
  'caller_requested_human',
  'other',
] as const
type Reason = (typeof REASON_ENUM)[number]

const CALLER_NAME_MAX = 80
const SUMMARY_MAX = 280

export async function POST(req: Request) {
  if (!verifyVapiSignature(req)) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const tc = toolCallFromVapiPayload(body)
  if (!tc) {
    return NextResponse.json({ error: 'unrecognized_payload_shape' }, { status: 400 })
  }

  // ── Validate LLM inputs (closed enum + length-capped strings). ──
  const reasonRaw = tc.arguments.reason
  if (typeof reasonRaw !== 'string' || !REASON_ENUM.includes(reasonRaw as Reason)) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: false,
      error: `reason must be one of: ${REASON_ENUM.join(', ')}`,
    }))
  }
  const reason: Reason = reasonRaw as Reason

  const callerNameRaw = tc.arguments.caller_name
  const callerName = typeof callerNameRaw === 'string'
    ? callerNameRaw.trim().slice(0, CALLER_NAME_MAX)
    : null

  const summaryRaw = tc.arguments.summary
  const summary = typeof summaryRaw === 'string'
    ? summaryRaw.trim().slice(0, SUMMARY_MAX)
    : null

  // ── Resolve org from the call envelope (dashboard test args
  //    override prod envelope values, same pattern as other tools). ──
  // Identity hard-locked to call envelope in prod; LLM-supplied
  // to_e164/from_e164/phone_number args refused outside dev.
  const { toE164, fromE164 } = resolveCallEnvelope(tc)
  if (!toE164) {
    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: false,
      error: 'Missing or unparseable to_e164',
    }))
  }

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('id, name, timezone, call_agent_enabled, call_agent_baa_attested_at, call_agent_fallback_e164, call_agent_business_hours')
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

  // ── Eligibility: fallback configured AND (no business hours set
  //    OR currently inside business hours). When business_hours is
  //    null we assume the owner takes responsibility for staffing;
  //    when it IS configured we honor it strictly so we don't ring
  //    an empty office at 2am. ──
  const fallback = (org.call_agent_fallback_e164 ?? '').trim() || null
  const tz = org.timezone || 'America/New_York'
  const businessHours = org.call_agent_business_hours
  const businessHoursConfigured = !!businessHours && typeof businessHours === 'object'
  const insideHours = businessHoursConfigured
    ? isWithinBusinessHours(new Date(), businessHours, tz)
    : true

  const fromTail = fromE164 ? fromE164.replace(/\D/g, '').slice(-4) : null

  if (!fallback || !insideHours) {
    // Downgrade: tell the LLM to pivot to take_message. We still
    // audit the attempt so owners can see how often Layla wanted
    // to hand off but couldn't.
    try {
      await supabaseAdmin.from('activity_log').insert({
        organization_id: org.id,
        action:          'voice_transferred',
        metadata: {
          transferred:      false,
          downgrade_reason: !fallback ? 'no_fallback_configured' : 'outside_business_hours',
          reason,
          caller_name:      callerName,
          summary,
          from_e164_tail:   fromTail,
          call_sid:         tc.callSid ?? null,
        },
      })
    } catch {
      console.error('[voice/transfer-to-human] activity_log insert failed (downgrade branch)')
    }

    return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
      ok: true,
      output: {
        transferred: false,
        reason: 'fallback_unavailable',
        guidance: 'Apologize briefly, then call the take_message tool to capture a callback.',
      },
    }))
  }

  // ── Success: directive for the Vapi/Twilio bridge to dial out. ──
  try {
    await supabaseAdmin.from('activity_log').insert({
      organization_id: org.id,
      action:          'voice_transferred',
      metadata: {
        transferred:    true,
        reason,
        caller_name:    callerName,
        summary,
        from_e164_tail: fromTail,
        call_sid:       tc.callSid ?? null,
      },
    })
  } catch {
    console.error('[voice/transfer-to-human] activity_log insert failed (transfer branch)')
  }

  return NextResponse.json(toolCallResponseForVapi(tc.toolCallId, {
    ok: true,
    output: {
      transferred:          true,
      transfer_destination: fallback,
      reason,
      caller_name:          callerName,
      // PHI guardrail: surface the summary back to the call layer so
      // it can be passed as Vapi handoff metadata to the receiving
      // human. Do NOT include it in any email body downstream.
      summary,
    },
  }))
}

// ─── Business-hours helper ────────────────────────────────────────
// Duplicated from src/app/api/webhooks/twilio/voice/route.ts where it
// lives as a private function. If a third caller needs this, extract
// to src/lib/voice-agent/business-hours.ts.

function isWithinBusinessHours(now: Date, raw: unknown, timezone: string): boolean {
  if (!raw || typeof raw !== 'object') return false
  const weekdayShort = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, weekday: 'short',
  }).format(now)
  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  }
  const weekday = weekdayMap[weekdayShort]
  if (weekday === undefined) return false
  const timeStr = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(now)
  const [hh, mm] = timeStr.split(':').map(Number)
  const minutesNow = hh * 60 + mm
  const todays = (raw as Record<string, Array<{ start: string; end: string }>>)[String(weekday)]
  if (!Array.isArray(todays)) return false
  for (const win of todays) {
    const [sh, sm] = win.start.split(':').map(Number)
    const [eh, em] = win.end.split(':').map(Number)
    const sMin = sh * 60 + sm
    const eMin = eh * 60 + em
    if (minutesNow >= sMin && minutesNow < eMin) return true
  }
  return false
}
