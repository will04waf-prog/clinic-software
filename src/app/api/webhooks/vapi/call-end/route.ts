/**
 * POST /api/webhooks/vapi/call-end — Phase 5 W1.
 *
 * Vapi POSTs here when a call wraps. Payload contains the call sid,
 * caller info, duration, transcript, recording URL, and any tool
 * outcomes from the call.
 *
 * We persist a call_logs row + activity_log + (eventually) trigger
 * follow-up automation hooks. Idempotent on call_sid.
 *
 * Outcome inference: Vapi's payload includes an `endedReason` string
 * — we map a small set to our outcome enum and default to
 * 'completed' for normal hangups. Safety handoffs are recognized by
 * a transferred-call status + the safety_trigger_label that the
 * agent recorded during the call (passed back in metadata).
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { verifyVapiSignature } from '@/lib/voice-agent/verify-vapi-signature'
import { persistCallLog } from '@/lib/voice-agent/persist-call'
import { normalizePhone } from '@/lib/validators'

type VapiCallEndPayload = {
  message?: {
    type?: string
    call?: {
      id?:       string                  // Twilio CallSid
      startedAt?: string
      endedAt?:   string
      endedReason?: string
      durationMs?: number
      phoneNumber?: { number?: string }  // clinic-side Twilio number (To)
      customer?: { number?: string }     // caller (From)
      assistantId?: string
      metadata?: Record<string, unknown>
    }
    transcript?: unknown                  // Vapi's structured transcript
    recordingUrl?: string
    summary?: string
    analysis?: {
      structuredData?: { intent?: string; safety_trigger_label?: string; recording_consent?: boolean }
    }
  }
}

function mapOutcome(endedReason: string | undefined): 'completed' | 'transferred' | 'voicemail' | 'safety_handoff' | 'no_consent' | 'agent_error' {
  if (!endedReason) return 'completed'
  const r = endedReason.toLowerCase()
  if (r.includes('transfer'))  return 'transferred'
  if (r.includes('voicemail')) return 'voicemail'
  if (r.includes('safety'))    return 'safety_handoff'
  if (r.includes('no_consent') || r.includes('declined-recording')) return 'no_consent'
  if (r.includes('error') || r.includes('fail')) return 'agent_error'
  return 'completed'
}

export async function POST(req: Request) {
  if (!verifyVapiSignature(req)) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 })
  }

  const body: VapiCallEndPayload | null = await req.json().catch(() => null)
  const msg = body?.message
  const call = msg?.call
  if (!msg || !call || !call.id) {
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 })
  }

  // Only handle end-of-call events. Vapi sends many event types
  // (function-call, status-update, end-of-call-report). Tool calls
  // come in on /api/voice/tool/*; status-updates we don't act on
  // for V1.
  if (msg.type && msg.type !== 'end-of-call-report' && msg.type !== 'end-of-call') {
    return NextResponse.json({ ok: true, skipped: msg.type })
  }

  const toE164   = normalizePhone(call.phoneNumber?.number ?? '') ?? (call.phoneNumber?.number ?? '')
  const fromE164 = normalizePhone(call.customer?.number ?? '')   ?? (call.customer?.number ?? '')
  if (!toE164 || !fromE164) {
    return NextResponse.json({ error: 'missing_phone_numbers' }, { status: 400 })
  }

  // Resolve org by To-number. Same pattern as the voice webhook.
  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('id')
    .eq('twilio_phone_number', toE164)
    .maybeSingle()
  if (!org) {
    // Unknown To-number → log warning + 200 (no-op) so Vapi
    // doesn't keep retrying for a misconfigured call.
    console.warn('[vapi/call-end] no org for to_e164', toE164)
    return NextResponse.json({ ok: true, ignored: true })
  }

  const result = await persistCallLog({
    orgId:        org.id,
    callSid:      call.id,
    fromE164,
    toE164,
    direction:    'inbound',
    startedAt:    call.startedAt ?? new Date().toISOString(),
    endedAt:      call.endedAt   ?? null,
    durationSec:  call.durationMs != null ? Math.round(call.durationMs / 1000) : null,
    intent:       msg.analysis?.structuredData?.intent ?? null,
    transcript:   msg.transcript ?? null,
    recordingUrl: msg.recordingUrl ?? null,
    recordingConsentObtained: msg.analysis?.structuredData?.recording_consent === true,
    safetyTriggerLabel:       msg.analysis?.structuredData?.safety_trigger_label ?? null,
    outcome:      mapOutcome(call.endedReason),
    followupSummary: msg.summary ?? null,
  })

  // If the insert genuinely failed (DB blip, transient outage), return
  // 5xx so Vapi retries on its own backoff. The previous behavior was
  // 200 ok:true even on failure, silently dropping the transcript +
  // recording url forever. persistCallLog returns inserted:false also
  // for the legitimate idempotent-skip case (call_sid already exists)
  // — distinguish via the callLogId field: a successful skip has the
  // existing row's id, a true failure has none.
  if (!result.inserted && !result.callLogId) {
    return NextResponse.json({ ok: false, error: 'persist_failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, ...result })
}
