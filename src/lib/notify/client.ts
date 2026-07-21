/**
 * notifyClient — send a CRM-loop message to the CUSTOMER (estimate link,
 * approval confirmation, job reminder). Distinct from notifyOwner (which
 * is hardwired to owner alert types and the org's own number).
 *
 * Ladder: WhatsApp template (out-of-session — a client starts with no
 * open session) → SMS fallback → nothing. The public link is ALWAYS
 * returned regardless of channel, so the loop still works before
 * WhatsApp (Meta approval) or A2P is live: the owner shares the link
 * from their own phone. That's the correct v1 behavior for this segment.
 *
 * Kept in its own file so the owner send path (whatsapp.ts / index.ts),
 * whose templates are pending Meta review, is never disturbed.
 */
import { getTwilioClient, isTwilioConfigured, sendSMS } from '@/lib/twilio'
import { isWhatsAppEnabled } from './whatsapp'
import { clientMessagingBlocked } from './kill-switch'
import { clientTemplateVariant, templateContentSid, type ClientTemplateType, type TemplateLang } from './templates'

export interface NotifyClientInput {
  /** Org whose a2p_status governs the SMS fallback. */
  orgId: string
  /** Client phone in E.164. */
  toPhone: string
  /** Client language (from contact.preferred_language). */
  lang: TemplateLang
  templateType: ClientTemplateType
  /** Positional {{1..}} values, in order. */
  variables: string[]
  /** Already-localized SMS fallback body. */
  smsBody: string
  /** Public link — always echoed back for manual sharing. */
  link: string
}

export type NotifyClientResult = { channel: 'whatsapp' | 'sms' | 'none'; link: string }

export async function notifyClient(input: NotifyClientInput): Promise<NotifyClientResult> {
  // 0. Per-tenant kill switch (shared-sender insurance). Blocked orgs
  //    send NOTHING to customers on any channel; the link still comes
  //    back so in-app surfaces keep working.
  if (await clientMessagingBlocked(input.orgId)) {
    console.warn(`[notifyClient] org ${input.orgId} is messaging-blocked — send suppressed`)
    return { channel: 'none', link: input.link }
  }

  // 1. WhatsApp template (out-of-session). No-ops cleanly when disabled,
  //    unconfigured, or the template SID isn't set yet.
  if (isWhatsAppEnabled() && isTwilioConfigured()) {
    const fromRaw = process.env.TWILIO_WHATSAPP_FROM
    const contentSid = templateContentSid(clientTemplateVariant(input.templateType, input.lang))
    if (fromRaw && fromRaw.trim() && contentSid) {
      try {
        const from = fromRaw.startsWith('whatsapp:') ? fromRaw.trim() : `whatsapp:${fromRaw.trim()}`
        const contentVariables = JSON.stringify(
          Object.fromEntries(input.variables.map((v, i) => [String(i + 1), v])),
        )
        await getTwilioClient().messages.create({
          from, to: `whatsapp:${input.toPhone}`, contentSid, contentVariables,
        })
        return { channel: 'whatsapp', link: input.link }
      } catch (err) {
        console.error('[notifyClient] whatsapp failed, trying SMS:', err instanceof Error ? err.message : err)
      }
    }
  }

  // 2. SMS fallback (skips cleanly if A2P-gated or Twilio unconfigured).
  const sms = await sendSMS(input.toPhone, input.smsBody, { organizationId: input.orgId })
  if (sms && sms.provider_id) return { channel: 'sms', link: input.link }

  // 3. Neither channel delivered — the owner shares the link manually.
  return { channel: 'none', link: input.link }
}
