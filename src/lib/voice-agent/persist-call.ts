/**
 * Phase 5 W1 — persist a completed voice call to call_logs.
 *
 * Resolves the contact by from-phone (matches the inbound SMS
 * pattern: ilike last-10-digit suffix + JS exact compare on
 * remaining digits, auto-create on first touch). Inserts the
 * call_logs row, also writes activity_log so the contact timeline
 * picks it up.
 *
 * Idempotent on call_sid via the unique index. A duplicate
 * call-end webhook (Vapi retry) is silently no-op.
 */

import { supabaseAdmin } from '@/lib/supabase/admin'
import { normalizePhone } from '@/lib/validators'

export interface PersistCallInput {
  orgId:                     string
  callSid:                   string
  fromE164:                  string
  toE164:                    string
  direction:                 'inbound' | 'outbound'
  startedAt:                 string
  endedAt:                   string | null
  durationSec:               number | null
  intent:                    string | null
  transcript:                unknown | null
  recordingUrl:              string | null
  recordingConsentObtained:  boolean
  safetyTriggerLabel:        string | null
  outcome:                   'completed' | 'transferred' | 'voicemail' | 'safety_handoff' | 'no_consent' | 'agent_error'
  followupSummary:           string | null
  /** Multi-vertical Phase 2: dominant call language ('en'|'es'), as
   *  reported by Layla via post_call_summary_email. null on English-
   *  only lines and pre-feature calls. */
  detectedLanguage?:         'en' | 'es' | null
  /** Multi-vertical Phase 4: set when flag_urgent fired (trades
   *  business emergency). Defaults false. */
  isUrgent?:                 boolean
  urgencyReason?:            string | null
}

export async function persistCallLog(input: PersistCallInput): Promise<{ inserted: boolean; callLogId?: string; contactId?: string }> {
  // Idempotency: check if a row with this call_sid already exists.
  // We don't rely on the unique constraint to fail the insert
  // because we'd lose visibility into which body won.
  const existing = await supabaseAdmin
    .from('call_logs')
    .select('id, contact_id')
    .eq('call_sid', input.callSid)
    .maybeSingle()
  if (existing.data) {
    return { inserted: false, callLogId: existing.data.id, contactId: existing.data.contact_id ?? undefined }
  }

  // Resolve contact by last-10 of from_e164. Match inbound-SMS pattern.
  const last10 = (normalizePhone(input.fromE164) ?? input.fromE164).replace(/\D/g, '').slice(-10)
  let contactId: string | null = null
  if (last10.length === 10) {
    const { data: candidates } = await supabaseAdmin
      .from('contacts')
      .select('id, phone')
      .eq('organization_id', input.orgId)
      .eq('is_archived', false)
      .ilike('phone', `%${last10}`)
      .limit(5)
    const exact = (candidates ?? []).find(
      c => (c.phone ?? '').replace(/\D/g, '').slice(-10) === last10,
    )
    contactId = exact?.id ?? null
  }

  // Auto-create on first touch — same pattern as inbound SMS, just
  // with source='inbound_voice' so the analytics can tell where the
  // lead came from. ONLY when we have a clean 10-digit number: an
  // anonymous / blocked caller (last10 < 10 digits, e.g. "anonymous"
  // or empty) used to create a junk contact with a malformed phone
  // that no future caller could ever match against, polluting the
  // pipeline with one row per blocked call.
  if (!contactId && last10.length === 10) {
    const { data: defaultStage } = await supabaseAdmin
      .from('pipeline_stages')
      .select('id')
      .eq('organization_id', input.orgId)
      .eq('is_default', true)
      .maybeSingle()
    const stageId = defaultStage?.id ?? null

    const { data: created } = await supabaseAdmin
      .from('contacts')
      .insert({
        organization_id: input.orgId,
        first_name:      'Unknown (Call)',
        phone:           normalizePhone(input.fromE164) ?? input.fromE164,
        source:          'inbound_voice',
        stage_id:        stageId,
        status:          'lead',
      })
      .select('id')
      .single()
    contactId = created?.id ?? null
  }

  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from('call_logs')
    .insert({
      organization_id:            input.orgId,
      contact_id:                 contactId,
      call_sid:                   input.callSid,
      from_e164:                  normalizePhone(input.fromE164) ?? input.fromE164,
      to_e164:                    normalizePhone(input.toE164)   ?? input.toE164,
      direction:                  input.direction,
      started_at:                 input.startedAt,
      ended_at:                   input.endedAt,
      duration_sec:               input.durationSec,
      intent:                     input.intent,
      transcript:                 input.transcript,
      recording_url:              input.recordingUrl,
      recording_consent_obtained: input.recordingConsentObtained,
      safety_trigger_label:       input.safetyTriggerLabel,
      outcome:                    input.outcome,
      followup_summary:           input.followupSummary,
      detected_language:          input.detectedLanguage ?? null,
      is_urgent:                  input.isUrgent ?? false,
      urgency_reason:             input.urgencyReason ?? null,
    })
    .select('id')
    .single()
  if (insertErr || !inserted) {
    console.error('[persist-call] insert failed:', insertErr?.message)
    return { inserted: false }
  }

  // Multi-vertical Phase 2: stamp the caller's preferred follow-up
  // language. NULL-GUARDED — an English-only line reports no language,
  // so `detectedLanguage` is null and we skip the update entirely,
  // never erasing a previously-known 'es'. A non-null value is
  // last-write-wins per the spec.
  if (input.detectedLanguage && contactId) {
    await supabaseAdmin
      .from('contacts')
      .update({ preferred_language: input.detectedLanguage })
      .eq('id', contactId)
  }

  // Activity log row so the timeline picks it up alongside SMS +
  // pipeline-stage moves.
  await supabaseAdmin.from('activity_log').insert({
    organization_id: input.orgId,
    contact_id:      contactId,
    action:          `call_${input.outcome}`,
    metadata: {
      call_log_id:           inserted.id,
      call_sid:              input.callSid,
      direction:             input.direction,
      duration_sec:          input.durationSec,
      intent:                input.intent,
      safety_trigger_label:  input.safetyTriggerLabel,
    },
  })

  return { inserted: true, callLogId: inserted.id, contactId: contactId ?? undefined }
}
