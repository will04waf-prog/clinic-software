/**
 * Phase 5 — owner email on call-end with a structured disposition.
 *
 * Closes the "what did Layla do all day?" loop for owners. Mirrors
 * src/lib/booking/owner-notification.ts and
 * src/lib/voice/message-notification.ts: Resend wrapper, fire-and-
 * forget shape, PHI-free body, activity_log-based durable dedupe
 * plus Resend's idempotencyKey belt-and-suspenders.
 *
 * STRICT PHI POLICY: the body contains ONLY the disposition (closed
 * enum) + clinic name + a deep link. No patient name, no phone, no
 * appointment time, and CRITICALLY no LLM-supplied summary_text —
 * that prose may have slipped PHI past the prompt and never goes
 * over email. The owner reads the full summary inside the app.
 */

import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendEmail, wrapEmailHtml } from '@/lib/resend'
import { getAppUrl } from '@/lib/voice-agent/app-url'
import { notifyOwner } from '@/lib/notify'

export type CallDisposition =
  | 'booked'
  | 'rescheduled'
  | 'canceled'
  | 'info_only'
  | 'message_taken'
  | 'transferred'
  | 'abandoned'
  | 'escalation_needed'

export interface NotifyOwnerOfCallSummaryArgs {
  organizationId: string
  /** Twilio call sid — also the transcript deep-link target. */
  callSid: string
  disposition: CallDisposition
}

/**
 * One-shot owner alert per (org, call_sid). Safe to call multiple
 * times for the same call_sid — the activity_log dedupe row + the
 * Resend Idempotency-Key both prevent duplicate delivery. Never
 * throws; callers should wrap in after().
 */
export async function notifyOwnerOfCallSummary(
  args: NotifyOwnerOfCallSummaryArgs,
): Promise<void> {
  if (!process.env.RESEND_API_KEY) return

  const action = 'owner_notified_call_summary'

  // ── Owner + org name lookup. We resolve identity BEFORE claiming
  // the dedupe row so that a missing owner email doesn't leave behind
  // a phantom "notified" row that suppresses a future retry once the
  // owner profile is fixed. ──
  const [{ data: owner }, { data: org }] = await Promise.all([
    supabaseAdmin
      .from('profiles')
      .select('email, full_name')
      .eq('organization_id', args.organizationId)
      .eq('role', 'owner')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from('organizations')
      .select('name, owner_language')
      .eq('id', args.organizationId)
      .single(),
  ])

  if (!owner?.email) return
  const orgName = org?.name ?? 'your clinic'
  // Multi-vertical Phase 2: owner-facing output follows owner_language,
  // independent of the call's language (an English call still summarizes
  // to a Spanish-speaking owner in Spanish).
  const ownerLang: 'en' | 'es' = org?.owner_language === 'es' ? 'es' : 'en'

  // ── Race-safe dedupe: INSERT the claim ticket FIRST, only send
  // the email if the insert succeeds. The partial UNIQUE index
  // activity_log_call_summary_uniq (migration
  // 20260712110000_call_summary_dedupe_uniq) on (organization_id,
  // metadata->>'call_sid') WHERE action='owner_notified_call_summary'
  // is what makes this atomic — Postgres raises 23505 on the loser,
  // we treat that as "someone else won, no-op." This replaces the
  // older SELECT-then-INSERT pattern which had a check-then-act race
  // window between two retried tool-call invocations. ──
  const { error: claimErr } = await supabaseAdmin.from('activity_log').insert({
    organization_id: args.organizationId,
    action,
    metadata: {
      call_sid:    args.callSid,
      disposition: args.disposition,
    },
  })
  if (claimErr) {
    // 23505 = unique_violation = another concurrent invocation
    // already claimed this (org, call_sid). That's the happy path
    // for dedupe — silently no-op.
    if (claimErr.code === '23505') return
    console.error('[call-summary-notification] dedupe claim insert failed', claimErr.message)
    return
  }

  // Deep link to the transcript view by call_sid. The page may 404
  // until the transcript UI lands — owners still get the URL on
  // record and can pivot to the calls/inbox surface manually.
  const transcriptUrl = `${getAppUrl()}/calls/${encodeURIComponent(args.callSid)}`

  // PHI-free, single-line copy. The disposition is a closed enum, so
  // no free-form text can leak through this surface — and the Spanish
  // labels below are natively written, not machine-translated.
  const DISP_ES: Record<CallDisposition, string> = {
    booked:            'reservada',
    rescheduled:       'reprogramada',
    canceled:          'cancelada',
    info_only:         'informativa',
    message_taken:     'mensaje tomado',
    transferred:       'transferida',
    abandoned:         'abandonada',
    escalation_needed: 'requiere atención',
  }
  const disp = ownerLang === 'es' ? DISP_ES[args.disposition] : args.disposition
  const subject = ownerLang === 'es'
    ? `Resumen de llamada en ${orgName}: ${disp}`
    : `Call summary at ${orgName}: ${disp}`
  const html = wrapEmailHtml(
    (ownerLang === 'es'
      ? [
          `Llamada completada: ${disp} en ${orgName}. Abra ClinIQ para ver la transcripción.`,
          `Ver la transcripción: ${transcriptUrl}`,
        ]
      : [
          `Call completed: ${disp} at ${orgName}. Open ClinIQ for the transcript.`,
          `Open the transcript: ${transcriptUrl}`,
        ]
    ).join('\n'),
    orgName,
  )

  try {
    await sendEmail({
      to: owner.email,
      subject,
      html,
      // Belt-and-suspenders alongside the DB-level claim row above:
      // if the same call_sid somehow re-runs after the claim is
      // already in place (e.g. owner email retry), Resend's 24h
      // idempotency window still catches it.
      idempotencyKey: `voice_call_summary:${args.callSid}`,
    })
  } catch {
    console.error('[call-summary-notification] resend send failed')
  }

  // Additive phone-channel push (SMS/WhatsApp per notification_channel).
  // Reached only by the dedupe winner above, so it fires once per call.
  // Inert until the owner sets owner_notify_e164; WhatsApp stays off
  // until WHATSAPP_ENABLED. PHI-free — disposition + link only.
  await notifyOwner({
    organizationId: args.organizationId,
    type: 'job_summary',
    smsBody: ownerLang === 'es'
      ? `Layla: llamada ${disp} en ${orgName}. Ver: ${transcriptUrl}`
      : `Layla: call ${disp} at ${orgName}. View: ${transcriptUrl}`,
    templateVariables: [orgName, disp, transcriptUrl],
  })
}
