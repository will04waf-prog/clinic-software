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

const PUBLIC_APP_URL =
  process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? 'https://tarhunna.net'

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

  // ── Durable dedupe per call_sid. ──
  const { data: priorNotice } = await supabaseAdmin
    .from('activity_log')
    .select('id')
    .eq('organization_id', args.organizationId)
    .eq('action', action)
    .contains('metadata', { call_sid: args.callSid })
    .limit(1)
    .maybeSingle()
  if (priorNotice) return

  // ── Owner + org name lookup. ──
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
      .select('name')
      .eq('id', args.organizationId)
      .single(),
  ])

  if (!owner?.email) return
  const orgName = org?.name ?? 'your clinic'

  // Deep link to the transcript view by call_sid. The page may 404
  // until the transcript UI lands — owners still get the URL on
  // record and can pivot to the calls/inbox surface manually.
  const transcriptUrl = `${PUBLIC_APP_URL}/calls/${encodeURIComponent(args.callSid)}`

  // PHI-free, single-line copy. The disposition is a closed enum so
  // no free-form text can leak through this surface.
  const html = wrapEmailHtml(
    [
      `Call completed: ${args.disposition} at ${orgName}. Open ClinIQ for the transcript.`,
      `Open the transcript: ${transcriptUrl}`,
    ].join('\n'),
    orgName,
  )

  try {
    await sendEmail({
      to: owner.email,
      subject: `Call summary at ${orgName}: ${args.disposition}`,
      html,
      idempotencyKey: `voice_call_summary:${args.callSid}`,
    })
  } catch {
    console.error('[call-summary-notification] resend send failed')
    return
  }

  await supabaseAdmin.from('activity_log').insert({
    organization_id: args.organizationId,
    action,
    metadata: {
      call_sid:    args.callSid,
      disposition: args.disposition,
    },
  })
}
