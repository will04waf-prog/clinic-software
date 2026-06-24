/**
 * Autonomous SMS send orchestrator — Phase 2 W9.
 *
 * Called from autoDraftForInbound after a pending ai_drafts row has
 * been pre-claimed (using the unique partial index on pending as a
 * mutex). This function decides whether to send and, if so, sends
 * the SMS, persists the outbound + sms_log + activity_log, then
 * UPDATES the pre-claimed row from 'pending' → 'auto_sent'.
 *
 * Pre-claim model: the DB row is the serialization point. Two
 * concurrent invocations against the same trigger both fail at the
 * pending insert (one wins, one gets 23505) BEFORE Twilio is
 * touched. After Twilio returns, the row transitions to 'auto_sent';
 * if Twilio fails, the row stays 'pending' for the human to handle.
 * If the outbound messages insert fails AFTER Twilio sent, we
 * transition to 'auto_sent' anyway (without sent_message_id) so the
 * human Send button can't fire a duplicate.
 *
 * Refuses by default. Returns ok=false unless every gate passes AND
 * Twilio accepts.
 */

import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendSMS, isTwilioConfigured } from '@/lib/twilio'
import {
  checkAutoSendEligibility,
  AUTO_SEND_BANNED_PHRASE_LOOKBACK_DAYS,
  type EligibilityReasonCode,
} from '@/lib/auto-send-eligibility'
import {
  computeVoiceHealth,
  HEALTH_WINDOW_DAYS,
  type ExampleCountByClass,
  type HealthDraftRow,
} from '@/lib/voice-health'
import {
  readVoiceProfile,
  VOICE_EXAMPLE_CLASSES,
  type VoiceExampleClass,
} from '@/lib/voice-profile'
import { safetyTrigger } from '@/lib/inbound-classifier'

export interface AttemptAutoSendArgs {
  organizationId: string
  contactId: string
  contactPhone: string | null
  contactSmsConsent: boolean
  contactOptedOut: boolean
  clinicName: string
  orgAutoSendEnabled: boolean
  orgAutoSendClasses: ReadonlyArray<string>
  isInQuietHours: boolean
  triggerMessageId: string
  /** Classifier result. 'unknown' is never eligible. */
  messageClass: VoiceExampleClass | 'unknown'
  inboundBody: string
  draftBody: string
  /** Pre-rendered disclosure footer to append at send time. */
  disclosureFooter: string
  model: string
  /**
   * The pre-claimed pending ai_drafts row's id. attemptAutoSend will
   * transition this row from 'pending' to 'auto_sent' on success.
   */
  draftRowId: string
}

export type AttemptAutoSendResult =
  | { ok: true; messageId: string | null }
  | { ok: false; reason_code: EligibilityReasonCode | 'twilio_not_configured' | 'send_failed' | 'persist_failed'; reason: string }

export async function attemptAutoSend(args: AttemptAutoSendArgs): Promise<AttemptAutoSendResult> {
  // ── Fast-path rejection: skip all DB work if obviously ineligible. ──
  if (!args.orgAutoSendEnabled) {
    return { ok: false, reason_code: 'org_master_disabled', reason: 'Master toggle is off.' }
  }
  if (args.messageClass === 'unknown') {
    return { ok: false, reason_code: 'class_is_unknown', reason: 'Classifier was not confident.' }
  }
  if (!args.orgAutoSendClasses.includes(args.messageClass)) {
    return { ok: false, reason_code: 'class_not_in_allowlist', reason: `Class "${args.messageClass}" not in allowlist.` }
  }
  // Safety trigger — cheap, runs before any DB roundtrip.
  const safetyLabel = safetyTrigger(args.inboundBody)
  if (safetyLabel) {
    return { ok: false, reason_code: 'safety_trigger_matched', reason: `Inbound matched safety blocklist ("${safetyLabel}").` }
  }
  if (!args.contactPhone) {
    return { ok: false, reason_code: 'send_failed', reason: 'Contact has no phone number on file.' }
  }
  if (args.contactOptedOut) {
    return { ok: false, reason_code: 'contact_opted_out', reason: 'Contact opted out of SMS.' }
  }
  if (!args.contactSmsConsent) {
    return { ok: false, reason_code: 'no_sms_consent', reason: 'Contact has not granted SMS consent.' }
  }
  if (args.isInQuietHours) {
    return { ok: false, reason_code: 'in_quiet_hours', reason: 'Inside quiet hours.' }
  }

  // ── Load voice health + banned-phrase recency + fresh master toggle. ──
  // Re-read ai_twin_auto_send_enabled inside this call so a kill
  // switch flipped while generateDraft was running (2-5s) takes
  // effect before Twilio fires.
  const windowStart = new Date(Date.now() - HEALTH_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  const bannedLookback = new Date(Date.now() - AUTO_SEND_BANNED_PHRASE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const [draftsRes, examplesRes, bannedHitsRes, orgRes] = await Promise.all([
    supabaseAdmin
      .from('ai_drafts')
      .select('id, state, draft_body, edit_distance, guardrail_violation, generated_at, context_snapshot')
      .eq('organization_id', args.organizationId)
      .gte('generated_at', windowStart.toISOString())
      .order('generated_at', { ascending: false })
      .limit(2000),
    supabaseAdmin
      .from('voice_examples')
      .select('class')
      .eq('organization_id', args.organizationId),
    supabaseAdmin
      .from('ai_drafts')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', args.organizationId)
      .eq('guardrail_violation', 'banned_phrase')
      .gte('generated_at', bannedLookback),
    // Re-read the master toggle + voice profile. Stale snapshot
    // protection: if the owner flipped OFF while we were generating,
    // catch it here before Twilio.
    supabaseAdmin
      .from('organizations')
      .select('ai_twin_voice_profile, ai_twin_auto_send_enabled, ai_twin_auto_send_classes, ai_twin_auto_send_rollout_pct, ai_twin_auto_send_shadow_mode')
      .eq('id', args.organizationId)
      .single(),
  ])

  // Fresh master-toggle check.
  if (orgRes.data?.ai_twin_auto_send_enabled !== true) {
    return { ok: false, reason_code: 'org_master_disabled', reason: 'Master toggle flipped off mid-flight.' }
  }
  const freshAllowlist = ((orgRes.data?.ai_twin_auto_send_classes as string[] | null) ?? [])
  if (!freshAllowlist.includes(args.messageClass)) {
    return { ok: false, reason_code: 'class_not_in_allowlist', reason: 'Class removed from allowlist mid-flight.' }
  }

  const rows: HealthDraftRow[] = ((draftsRes.data ?? []) as Array<{
    id: string
    state: string | null
    draft_body: string | null
    edit_distance: number | null
    guardrail_violation: string | null
    generated_at: string
    context_snapshot: unknown
  }>).map(r => {
    const snap =
      r.context_snapshot &&
      typeof r.context_snapshot === 'object' &&
      !Array.isArray(r.context_snapshot)
        ? (r.context_snapshot as Record<string, unknown>)
        : {}
    const rawClass = snap.voice_class
    const vc: VoiceExampleClass | null =
      typeof rawClass === 'string' && (VOICE_EXAMPLE_CLASSES as readonly string[]).includes(rawClass)
        ? (rawClass as VoiceExampleClass)
        : null
    const rawUsed = snap.voice_examples_used
    return {
      id: r.id,
      state: (r.state ?? 'pending') as HealthDraftRow['state'],
      draft_body: r.draft_body ?? '',
      edit_distance: r.edit_distance,
      guardrail_violation: r.guardrail_violation,
      generated_at: r.generated_at,
      voice_class: vc,
      voice_examples_used: typeof rawUsed === 'number' && Number.isFinite(rawUsed) ? rawUsed : null,
    }
  })

  const examplesByClass: ExampleCountByClass = {
    greeting: 0, faq: 0, follow_up: 0, consult_confirm: 0, follow_up_cold: 0, custom: 0,
  }
  for (const e of (examplesRes.data ?? []) as Array<{ class: string }>) {
    if ((VOICE_EXAMPLE_CLASSES as readonly string[]).includes(e.class)) {
      examplesByClass[e.class as VoiceExampleClass] += 1
    }
  }

  const profile = readVoiceProfile(orgRes.data?.ai_twin_voice_profile ?? {})
  const health = computeVoiceHealth(rows, examplesByClass, profile, windowStart)
  const classMetrics = health.per_class.find(c => c.class === args.messageClass) ?? null

  // ── Eligibility check. ──
  const rolloutPct =
    typeof (orgRes.data as { ai_twin_auto_send_rollout_pct?: number | null } | null)?.ai_twin_auto_send_rollout_pct === 'number'
      ? ((orgRes.data as { ai_twin_auto_send_rollout_pct: number }).ai_twin_auto_send_rollout_pct)
      : 100
  const shadowMode =
    (orgRes.data as { ai_twin_auto_send_shadow_mode?: boolean | null } | null)?.ai_twin_auto_send_shadow_mode === true

  const eligibility = checkAutoSendEligibility({
    orgMasterEnabled: true,
    orgAllowlist: freshAllowlist,
    messageClass: args.messageClass,
    safetyTriggerLabel: safetyLabel,
    isInQuietHours: args.isInQuietHours,
    hasSmsConsent: args.contactSmsConsent,
    contactOptedOut: args.contactOptedOut,
    classMetrics,
    // Banned-phrase gate is a safety check — fail SAFE on query error
    // (count===null + error set) rather than silently treating an
    // outage as "no violations found." Refusing to auto-send when we
    // can't verify is the only correct posture.
    recentBannedPhraseHits: bannedHitsRes.error
      ? Number.MAX_SAFE_INTEGER
      : (bannedHitsRes.count ?? 0),
    rolloutPct,
    contactId: args.contactId,
    shadowMode,
  })

  // ── W12 shadow simulation: every real gate passed but shadow_mode
  // is on. Persist a "would-have-sent" marker into context_snapshot,
  // emit an activity_log row, and return without firing Twilio. The
  // pending row stays as 'pending' so the human flow remains intact.
  if (!eligibility.eligible && eligibility.reason_code === 'shadow_mode') {
    const nowIso = new Date().toISOString()

    // Merge shadow markers into context_snapshot (read-modify-write —
    // the W9 pending-pre-claim invariant guarantees we're the only
    // writer for this draft row, so no concurrent clobber).
    const existing = await supabaseAdmin
      .from('ai_drafts')
      .select('context_snapshot')
      .eq('id', args.draftRowId)
      .single()
    const baseSnap =
      existing.data?.context_snapshot &&
      typeof existing.data.context_snapshot === 'object' &&
      !Array.isArray(existing.data.context_snapshot)
        ? (existing.data.context_snapshot as Record<string, unknown>)
        : {}
    const mergedSnap: Record<string, unknown> = {
      ...baseSnap,
      shadow_simulated:        true,
      shadow_would_have_sent:  true,
      shadow_reason:           eligibility.reason,
      shadow_classified_class: args.messageClass,
      shadow_at:               nowIso,
    }
    await supabaseAdmin
      .from('ai_drafts')
      .update({ context_snapshot: mergedSnap })
      .eq('id', args.draftRowId)

    await supabaseAdmin.from('activity_log').insert({
      organization_id: args.organizationId,
      contact_id:      args.contactId,
      action:          'ai_twin_auto_send_shadow_simulated',
      metadata: {
        // draft_id lets the audit page join through to the pending
        // row and show what the AI would have said.
        draft_id: args.draftRowId,
        shadow_mode: true,
        channel: 'sms',
        model: args.model,
        trigger: 'inbound_auto',
        trigger_message_id: args.triggerMessageId,
        message_class: args.messageClass,
        eligibility_reason: eligibility.reason,
        eligibility_reason_code: eligibility.reason_code,
        rollout_pct: rolloutPct,
        // Honest: shadow_mode passed every trust gate BUT bypassed
        // the rollout dial (per design — "show me everything I would
        // do"). The would-have-sent claim is contingent on rollout.
        rollout_bypassed_for_shadow: true,
        class_avg_edit_ratio: classMetrics?.avg_edit_ratio ?? null,
        class_ratio_sample_size: classMetrics?.ratio_sample_size ?? 0,
      },
    })

    return { ok: false, reason_code: 'shadow_mode', reason: eligibility.reason }
  }

  // ── W12 rollout throttle: cheap audit row so owners can see how
  // often the dial filters — return without further action and leave
  // the pending row for human review like any other refusal.
  if (!eligibility.eligible && eligibility.reason_code === 'rollout_throttled') {
    await supabaseAdmin.from('activity_log').insert({
      organization_id: args.organizationId,
      contact_id:      args.contactId,
      action:          'ai_twin_auto_send_rollout_throttled',
      metadata: {
        draft_id: args.draftRowId,
        channel: 'sms',
        trigger: 'inbound_auto',
        trigger_message_id: args.triggerMessageId,
        message_class: args.messageClass,
        eligibility_reason: eligibility.reason,
        rollout_pct: rolloutPct,
      },
    })
    return { ok: false, reason_code: 'rollout_throttled', reason: eligibility.reason }
  }

  if (!eligibility.eligible) {
    return { ok: false, reason_code: eligibility.reason_code, reason: eligibility.reason }
  }

  // ── Send the SMS. ──
  if (!isTwilioConfigured()) {
    return { ok: false, reason_code: 'twilio_not_configured', reason: 'Twilio is not configured.' }
  }

  const finalBody = args.draftBody + args.disclosureFooter

  let providerId: string | undefined
  let sendError: string | undefined
  try {
    const result = await sendSMS(args.contactPhone, finalBody)
    if (!result) {
      sendError = 'sendSMS returned null (unparseable phone or not configured)'
    } else {
      providerId = result.provider_id
    }
  } catch (err) {
    sendError = err instanceof Error ? err.message : 'sendSMS threw'
  }

  if (sendError || !providerId) {
    console.error('[ai-twin] auto-send: Twilio send failed', { orgId: args.organizationId, contactId: args.contactId, error: sendError })
    return { ok: false, reason_code: 'send_failed', reason: sendError ?? 'Send failed.' }
  }

  // ── Persist outbound message + transition draft row + audit. ──
  const nowIso = new Date().toISOString()

  const { data: insertedMessage, error: msgErr } = await supabaseAdmin
    .from('messages')
    .insert({
      organization_id: args.organizationId,
      contact_id:      args.contactId,
      channel:         'sms',
      direction:       'outbound',
      status:          'sent',
      body:            finalBody,
      to_address:      args.contactPhone,
      provider_id:     providerId,
      sent_at:         nowIso,
    })
    .select('id')
    .single()

  // CRITICAL: even if messages insert failed, we MUST transition the
  // draft row from 'pending' to 'auto_sent'. Leaving it as 'pending'
  // would let the human Send button fire a duplicate SMS to the
  // patient. Use draft_body=finalBody (with footer) so the audit
  // surface matches what the patient saw.
  if (msgErr || !insertedMessage) {
    console.error('[ai-twin] auto-send: SMS sent but messages insert FAILED — lock draft to prevent double-send', {
      orgId: args.organizationId, providerId, error: msgErr,
    })
    await supabaseAdmin.from('ai_drafts').update({
      state:           'auto_sent',
      edit_distance:   null,
      draft_body:      finalBody,
      resolved_at:     nowIso,
    }).eq('id', args.draftRowId)
    return { ok: false, reason_code: 'persist_failed', reason: msgErr?.message ?? 'Persist failed after send.' }
  }

  // Transition pending → auto_sent + sent_message_id. The unique
  // partial index ai_drafts_one_auto_sent_per_trigger_idx will catch
  // any concurrent insert attempts at this transition point (though
  // the pending pre-claim already serialized us upstream).
  const transition = await supabaseAdmin.from('ai_drafts').update({
    state:           'auto_sent',
    edit_distance:   null,
    sent_message_id: insertedMessage.id,
    draft_body:      finalBody,
    resolved_at:     nowIso,
  }).eq('id', args.draftRowId)
  if (transition.error) {
    console.warn('[ai-twin] auto-send: draft state transition failed', transition.error.message)
  }

  await supabaseAdmin.from('sms_log').insert({
    organization_id: args.organizationId,
    contact_id:      args.contactId,
    consultation_id: null,
    message_type:    'ai_auto_sent',
    to_number:       args.contactPhone,
    body:            finalBody,
    status:          'sent',
    provider_id:     providerId,
  })

  await supabaseAdmin.from('activity_log').insert({
    organization_id: args.organizationId,
    contact_id:      args.contactId,
    action:          'ai_twin_auto_sent',
    metadata: {
      channel: 'sms',
      model: args.model,
      trigger: 'inbound_auto',
      trigger_message_id: args.triggerMessageId,
      sent_message_id: insertedMessage.id,
      message_class: args.messageClass,
      eligibility_reason: eligibility.reason,
      eligibility_reason_code: eligibility.reason_code,
      class_avg_edit_ratio: classMetrics?.avg_edit_ratio ?? null,
      class_ratio_sample_size: classMetrics?.ratio_sample_size ?? 0,
    },
  })

  await supabaseAdmin
    .from('contacts')
    .update({ last_contacted_at: nowIso })
    .eq('id', args.contactId)

  return { ok: true, messageId: insertedMessage.id }
}
