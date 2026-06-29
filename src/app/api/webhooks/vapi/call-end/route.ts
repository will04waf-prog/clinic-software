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
import { recordUsage } from '@/lib/billing/metered-usage'

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
  // Accept call envelope from either nesting depth. Vapi's tool-calls
  // events nest it under message.call; some end-of-call-report
  // variants put it at the root alongside message. We've already
  // handled this in tool-types.ts for tool routes — mirror it here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const call: any = msg?.call ?? (body as any)?.call ?? null
  // Diagnostic: log the top-level shape so we can see what Vapi is
  // actually sending if any of the gates below reject. PHI-free —
  // only field names + presence booleans, no values.
  if (!msg || !call || !call.id) {
    console.warn('[vapi/call-end] invalid_payload', {
      bodyKeys:     body ? Object.keys(body as Record<string, unknown>) : null,
      msgKeys:      msg  ? Object.keys(msg  as Record<string, unknown>) : null,
      msgType:      msg?.type,
      hasCall:      !!call,
      hasCallId:    !!call?.id,
    })
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 })
  }

  // Only handle end-of-call events. Vapi sends many event types
  // (function-call, status-update, end-of-call-report). Tool calls
  // come in on /api/voice/tool/*; status-updates we don't act on
  // for V1.
  if (msg.type && msg.type !== 'end-of-call-report' && msg.type !== 'end-of-call') {
    return NextResponse.json({ ok: true, skipped: msg.type })
  }

  // Vapi's end-of-call-report does NOT carry the clinic-side
  // (phoneNumber) object in any release we've seen — only the
  // assistantId and the customer.number (the patient's phone).
  // Resolve the org by assistant id instead of by phone number,
  // then synthesize toE164 from organizations.twilio_phone_number.
  // The customer.number always represents the patient regardless
  // of direction (caller for inbound, callee for outbound).
  function pickNumber(obj: unknown, ...keys: string[]): string {
    if (!obj || typeof obj !== 'object') return ''
    for (const k of keys) {
      const v = (obj as Record<string, unknown>)[k]
      if (typeof v === 'string' && v.length > 0) return v
    }
    return ''
  }
  const customerRaw = pickNumber(call.customer, 'number', 'phone')
  // Backwards-compat: older Vapi payloads sometimes DID include
  // phoneNumber.{number,twilioPhoneNumber}. Use it if present, else
  // we'll fill from the org below.
  const phoneNumberRaw = pickNumber(call.phoneNumber, 'number', 'twilioPhoneNumber')
  const assistantId    = typeof call.assistantId === 'string' ? call.assistantId : null

  // Resolve org: prefer assistantId (matches either inbound or
  // reminder assistant), fall back to phoneNumber lookup for
  // backwards-compat with the older payload shape.
  let orgRow: { id: string; twilio_phone_number: string | null; is_reminder: boolean } | null = null
  if (assistantId) {
    const { data: byAssist } = await supabaseAdmin
      .from('organizations')
      .select('id, twilio_phone_number, call_agent_assistant_id, call_agent_reminder_assistant_id')
      .or(`call_agent_assistant_id.eq.${assistantId},call_agent_reminder_assistant_id.eq.${assistantId}`)
      .maybeSingle()
    if (byAssist) {
      orgRow = {
        id:                  byAssist.id,
        twilio_phone_number: byAssist.twilio_phone_number,
        is_reminder:         byAssist.call_agent_reminder_assistant_id === assistantId,
      }
    }
  }
  if (!orgRow && phoneNumberRaw) {
    const normalized = normalizePhone(phoneNumberRaw) ?? phoneNumberRaw
    const { data: byPhone } = await supabaseAdmin
      .from('organizations')
      .select('id, twilio_phone_number')
      .eq('twilio_phone_number', normalized)
      .maybeSingle()
    if (byPhone) {
      orgRow = { id: byPhone.id, twilio_phone_number: byPhone.twilio_phone_number, is_reminder: false }
    }
  }
  if (!orgRow) {
    console.warn('[vapi/call-end] no org match', { assistantId, hasPhoneNumber: !!phoneNumberRaw })
    return NextResponse.json({ ok: true, ignored: true })
  }

  // Direction + phone derivation:
  //   inbound  → customer is the FROM, org's Twilio is the TO
  //   outbound → customer is the TO,   org's Twilio is the FROM
  // Vapi's call.type is 'inboundPhoneCall' / 'outboundPhoneCall'.
  // Fall back to is_reminder (outbound only fires for reminders today).
  const isOutbound = (typeof call.type === 'string' && call.type.toLowerCase().includes('outbound'))
    || orgRow.is_reminder
  const direction: 'inbound' | 'outbound' = isOutbound ? 'outbound' : 'inbound'
  const orgPhone = orgRow.twilio_phone_number ?? phoneNumberRaw
  const customerE164 = normalizePhone(customerRaw) ?? customerRaw
  const orgE164      = normalizePhone(orgPhone   ?? '') ?? (orgPhone ?? '')
  const toE164   = direction === 'inbound' ? orgE164      : customerE164
  const fromE164 = direction === 'inbound' ? customerE164 : orgE164
  if (!toE164 || !fromE164) {
    console.warn('[vapi/call-end] could not derive phones after org match', {
      direction, orgPhone_present: !!orgPhone, customerRaw_len: customerRaw.length,
    })
    return NextResponse.json({ error: 'missing_phone_numbers' }, { status: 400 })
  }

  // Shim to keep the existing org lookup contract below — persistCallLog
  // takes orgId from `org`, so build a compatible local object.
  const org = { id: orgRow.id }

  // Vapi puts the call timestamps + duration at the MESSAGE level on
  // end-of-call-report, not under `call.*`. The empirical shape:
  //   message.startedAt:        ISO string
  //   message.endedAt:          ISO string
  //   message.durationSeconds:  number (Vapi's preferred field)
  //   message.durationMs:       number (older alias)
  // We accept any of them and fall back to startedAt/endedAt diff if
  // only the timestamps are present.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m: any = msg
  const startedAt: string =
    (typeof m.startedAt   === 'string' && m.startedAt) ||
    (typeof call.startedAt === 'string' && call.startedAt) ||
    new Date().toISOString()
  const endedAt: string | null =
    (typeof m.endedAt    === 'string' && m.endedAt) ||
    (typeof call.endedAt === 'string' && call.endedAt) ||
    null

  let durationSec: number | null = null
  if (typeof m.durationSeconds === 'number')      durationSec = Math.round(m.durationSeconds)
  else if (typeof m.durationMs       === 'number') durationSec = Math.round(m.durationMs       / 1000)
  else if (typeof call.durationMs    === 'number') durationSec = Math.round(call.durationMs    / 1000)
  else if (startedAt && endedAt) {
    const diff = (Date.parse(endedAt) - Date.parse(startedAt)) / 1000
    if (Number.isFinite(diff) && diff >= 0 && diff < 86400) durationSec = Math.round(diff)
  }

  const result = await persistCallLog({
    orgId:        org.id,
    callSid:      call.id,
    fromE164,
    toE164,
    direction,
    startedAt,
    endedAt,
    durationSec,
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

  // Phase 5 M7 — metered-billing audit. Record voice_minute usage AFTER
  // persistCallLog succeeds (so we don't bill for transcripts we failed
  // to store) but ONLY when result.inserted is true (so Vapi's webhook
  // retry doesn't double-record — the persist-layer's call_sid dedup
  // already absorbs the duplicate, and the usage_events idempotency
  // index on (org, kind, source_ref=call_sid) is the belt-and-suspenders
  // second line). Quantity is duration_sec/60 — fractional minutes, the
  // reporter ceils at submission time. Calls with no duration (failed
  // dial, missed call, etc.) get quantity=0 which recordUsage rejects,
  // so the audit row is silently skipped in that case.
  if (result.inserted && durationSec && durationSec > 0) {
    try {
      await recordUsage({
        organizationId: org.id,
        kind:           'voice_minute',
        quantity:       durationSec / 60,
        sourceRef:      call.id,
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[vapi/call-end] recordUsage failed (non-fatal):', msg)
    }
  }

  // Phase 5 W2: outbound reminder call lifecycle close-out. When the
  // reminder cron places a call it stamps metadata.consultation_id;
  // here we map Vapi's end-of-call disposition (which the assistant
  // typically signals via the post_call_summary_email tool, but is
  // also derivable from endedReason for the no-engagement cases)
  // onto consultations.voice_reminder_status. The CAS clause
  // .eq('voice_reminder_status','sent') makes this idempotent —
  // a retried webhook can only ever flip 'sent' once.
  const consultationId = typeof call.metadata?.consultation_id === 'string'
    ? call.metadata.consultation_id
    : null
  if (consultationId) {
    const summaryDisposition = (msg.analysis?.structuredData as Record<string, unknown> | undefined)?.disposition
    const reminderStatus =
      summaryDisposition === 'booked' || summaryDisposition === 'info_only' ? 'confirmed' :
      summaryDisposition === 'rescheduled'                                  ? 'rescheduled' :
      summaryDisposition === 'canceled'                                     ? 'canceled' :
      summaryDisposition === 'message_taken'                                ? 'declined' :
      summaryDisposition === 'abandoned'                                    ? 'no_answer' :
      // Fall back to mapping Vapi's endedReason for the cases where
      // post_call_summary_email never fired (caller hung up before
      // the model could call it).
      mapOutcome(call.endedReason) === 'voicemail'                          ? 'voicemail' :
      mapOutcome(call.endedReason) === 'agent_error'                        ? 'no_answer' :
      'confirmed'

    const { error: rmErr } = await supabaseAdmin
      .from('consultations')
      .update({ voice_reminder_status: reminderStatus })
      .eq('id', consultationId)
      .eq('voice_reminder_status', 'sent')
    if (rmErr) {
      console.error('[vapi/call-end] voice_reminder_status patch failed:', rmErr.message)
    }
  }

  return NextResponse.json({ ok: true, ...result })
}
