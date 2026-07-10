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
import { notifyOwner } from '@/lib/notify'

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

  // ── Owner + org name lookup, same shape as booking owner-notify.
  // We resolve identity BEFORE claiming the dedupe row so that a
  // missing owner email doesn't leave behind a phantom "notified"
  // row that suppresses a future retry once the profile is fixed. ──
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
  // Multi-vertical Phase 2: owner-facing output follows owner_language.
  const ownerLang: 'en' | 'es' = org?.owner_language === 'es' ? 'es' : 'en'

  // ── Race-safe dedupe: INSERT the claim ticket FIRST, only send
  // the email if the insert succeeds. The partial UNIQUE index
  // activity_log_voice_message_notify_uniq (migration
  // 20260712110000_call_summary_dedupe_uniq) on (organization_id,
  // metadata->>'voice_message_id') WHERE
  // action='owner_notified_voice_message' is what makes this atomic
  // — Postgres raises 23505 on the loser, we treat that as "someone
  // else won, no-op." Replaces the older SELECT-then-INSERT which
  // had a check-then-act race between two retried take_message
  // invocations or take_message + the persist-call retry path. ──
  const { error: claimErr } = await supabaseAdmin.from('activity_log').insert({
    organization_id: args.organizationId,
    action,
    metadata: {
      voice_message_id: args.voiceMessageId,
      urgency,
    },
  })
  if (claimErr) {
    // 23505 = unique_violation = another concurrent invocation
    // already claimed this (org, voice_message_id). That's the
    // happy path for dedupe — silently no-op.
    if (claimErr.code === '23505') return
    console.error('[voice-message-notification] dedupe claim insert failed', claimErr.message)
    return
  }

  const inboxUrl = `${getAppUrl()}/voice-messages`

  const subject = ownerLang === 'es'
    ? (urgency === 'urgent' ? `URGENTE: nuevo mensaje en ${orgName}` : `Nuevo mensaje en ${orgName}`)
    : (urgency === 'urgent' ? `URGENT: new message at ${orgName}`   : `New message at ${orgName}`)

  // PHI-free body. No caller name, no phone, no message text. Spanish
  // copy is natively written, not machine-translated.
  const html = wrapEmailHtml(
    (ownerLang === 'es'
      ? [
          `Un cliente dejó un mensaje en ${orgName} — abra ClinIQ para leerlo.`,
          `Abra la bandeja: ${inboxUrl}`,
        ]
      : [
          `A caller left a message at ${orgName} — open ClinIQ to read it.`,
          `Open the inbox: ${inboxUrl}`,
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
      // keyed on voice_message_id so a within-24h retry post-claim
      // still dedupes at Resend's transport layer.
      idempotencyKey: `voice_message_notify:${args.voiceMessageId}`,
    })
  } catch {
    console.error('[voice-message-notification] resend send failed')
  }

  // Additive phone-channel push. Always the PHI-free job_summary
  // template — a "you have a voicemail" nudge carries no caller
  // identity. (urgent_alert is reserved for flag_urgent, which is
  // trades-only and deliberately includes the caller's number.) The
  // urgency is conveyed in the body text, not the template. Inert until
  // owner_notify_e164 is set; WhatsApp gated by WHATSAPP_ENABLED.
  const detail = ownerLang === 'es' ? 'mensaje nuevo' : 'new message'
  await notifyOwner({
    organizationId: args.organizationId,
    type: 'job_summary',
    smsBody: ownerLang === 'es'
      ? `${urgency === 'urgent' ? 'URGENTE' : 'Layla'}: ${detail} en ${orgName}. Abra: ${inboxUrl}`
      : `${urgency === 'urgent' ? 'URGENT' : 'Layla'}: ${detail} at ${orgName}. Open: ${inboxUrl}`,
    templateVariables: [orgName, detail, inboxUrl],
  })
}
