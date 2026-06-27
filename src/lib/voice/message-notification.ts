/**
 * Phase 5 W2 — owner email when a caller leaves a message through
 * the Layla voice agent (take_message tool).
 *
 * Mirrors src/lib/booking/owner-notification.ts: same Resend
 * wrapper, same fire-and-forget shape, same PHI-free body, same
 * activity_log-based durable dedupe + idempotencyKey belt-and-
 * suspenders. The body intentionally carries NO patient identity
 * and NO message contents — just "open ClinIQ to read it" with a
 * deep link.
 *
 * Why per-voice_message_id dedupe (not per-contact): a single
 * caller can legitimately leave multiple distinct messages
 * (different calls, different topics). Keying on contact_id would
 * suppress every message after the first. The voice_messages row
 * id is the natural per-event identifier.
 */

import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendEmail, wrapEmailHtml } from '@/lib/resend'

import { getAppUrl } from '@/lib/voice-agent/app-url'

export interface NotifyOwnerOfVoiceMessageArgs {
  organizationId: string
  voiceMessageId: string
  /**
   * 'urgent' triggers a louder subject line. The body still carries
   * no PHI either way — urgency does NOT leak who called or why.
   */
  urgency?: 'normal' | 'urgent'
}

/**
 * Send the one-shot "new voicemail" email to the org owner.
 * Safe to call multiple times for the same voice_message_id —
 * dedupe row + Resend's idempotencyKey both guard against
 * duplicate delivery. Never throws.
 */
export async function notifyOwnerOfVoiceMessage(
  args: NotifyOwnerOfVoiceMessageArgs,
): Promise<void> {
  // ── Short-circuit if email isn't configured. Saves the DB
  // round-trips below in preview / dev / unconfigured envs. ──
  if (!process.env.RESEND_API_KEY) return

  const urgency: 'normal' | 'urgent' = args.urgency ?? 'normal'
  const action = 'owner_notified_voice_message'

  // ── Durable dedupe per voice_message_id. ──
  const { data: priorNotice } = await supabaseAdmin
    .from('activity_log')
    .select('id')
    .eq('organization_id', args.organizationId)
    .eq('action', action)
    .contains('metadata', { voice_message_id: args.voiceMessageId })
    .limit(1)
    .maybeSingle()
  if (priorNotice) return

  // ── Owner + org name lookup, same shape as booking owner-notify. ──
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

  const inboxUrl = `${getAppUrl()}/voice-messages`

  const subject = urgency === 'urgent'
    ? `URGENT: new message at ${orgName}`
    : `New message at ${orgName}`

  // PHI-free body. No caller name, no phone, no message text.
  const html = wrapEmailHtml(
    [
      `A caller left a message at ${orgName} — open ClinIQ to read it.`,
      `Open the inbox: ${inboxUrl}`,
    ].join('\n'),
    orgName,
  )

  try {
    await sendEmail({
      to: owner.email,
      subject,
      html,
      // Keyed on voice_message_id so each distinct message gets a
      // unique idempotencyKey within Resend's 24h dedup window.
      idempotencyKey: `voice_message_notify:${args.voiceMessageId}`,
    })
  } catch {
    console.error('[voice-message-notification] resend send failed')
    return
  }

  await supabaseAdmin.from('activity_log').insert({
    organization_id: args.organizationId,
    action,
    metadata: {
      voice_message_id: args.voiceMessageId,
      urgency,
    },
  })
}
