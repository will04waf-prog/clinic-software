/**
 * Urgent owner alert — the delivery half of flag_urgent (Phase 4).
 *
 * An urgent flag must NEVER be silent. This:
 *   1. Pushes immediately on the org's phone channel(s) via notifyOwner
 *      — with NO dedupe (unlike the call-summary/voice-message emails).
 *      Every urgent flag fires, every time.
 *   2. If no phone channel delivered (no owner mobile on file, or every
 *      send failed), falls back to email IMMEDIATELY — also un-deduped.
 *
 * Body carries the caller's phone + stated issue so the owner calls
 * back in one tap (rider 2). flag_urgent is trades-only, so the caller
 * number is not PHI.
 */

import { randomUUID } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendEmail, wrapEmailHtml } from '@/lib/resend'
import { notifyOwner } from './index'

export interface UrgentAlertInput {
  organizationId: string
  orgName: string
  ownerLanguage: 'en' | 'es'
  /** Caller's number in E.164, or a graceful "unavailable" placeholder. */
  callerPhone: string
  /** The caller's stated issue (short phrase). */
  issue: string
}

function urgentBody(input: UrgentAlertInput): string {
  return input.ownerLanguage === 'es'
    ? `URGENTE — ${input.orgName}. Un cliente necesita que le devuelvan la llamada ya. Problema: ${input.issue}. Llámelo: ${input.callerPhone}`
    : `URGENT — ${input.orgName}. A customer needs a callback now. Issue: ${input.issue}. Call them: ${input.callerPhone}`
}

/** Fire the urgent alert. Never throws; callers may wrap in after(). */
export async function alertOwnerUrgent(input: UrgentAlertInput): Promise<void> {
  const body = urgentBody(input)

  // 1. Immediate phone push — NO dedupe.
  const { delivered } = await notifyOwner({
    organizationId: input.organizationId,
    type: 'urgent_alert',
    smsBody: body,
    templateVariables: [input.orgName, input.callerPhone, input.issue],
  })
  if (delivered) return

  // 2. Rider 1 — never silent: no phone channel delivered → email now,
  // also bypassing dedupe (no idempotencyKey → sends every time).
  if (!process.env.RESEND_API_KEY) return
  const { data: owner } = await supabaseAdmin
    .from('profiles')
    .select('email')
    .eq('organization_id', input.organizationId)
    .eq('role', 'owner')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (!owner?.email) return

  const subject = input.ownerLanguage === 'es'
    ? `URGENTE: un cliente necesita respuesta en ${input.orgName}`
    : `URGENT: a customer needs a callback at ${input.orgName}`
  try {
    // Unique idempotency key per flag → Resend never dedupes an urgent
    // alert. (The API requires the field; a fresh UUID is how we opt
    // OUT of dedupe, matching the bypass-all-dedupe rule.)
    await sendEmail({
      to: owner.email,
      subject,
      html: wrapEmailHtml(body, input.orgName),
      idempotencyKey: `urgent:${randomUUID()}`,
    })
  } catch {
    console.error('[notify/urgent] email fallback failed')
  }
}
