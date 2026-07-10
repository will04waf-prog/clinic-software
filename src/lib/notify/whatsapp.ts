/**
 * Twilio WhatsApp sender.
 *
 * HARD GATE: WHATSAPP_ENABLED must be exactly 'true' to send anything.
 * It defaults to false EVERYWHERE, including production — the Meta
 * sender isn't approved until an operator flips it. Until then this
 * returns { ok:false, reason:'disabled' } and the caller falls back to
 * SMS, so no WhatsApp send is ever attempted.
 *
 * In-session (within 24h of the owner's last inbound WhatsApp) we send
 * a freeform message. Out-of-session, Meta requires a pre-approved
 * template — we send it by Content SID (see templates.ts). A missing
 * SID or sender returns a non-ok result so the caller falls back to SMS.
 */

import { getTwilioClient, isTwilioConfigured } from '@/lib/twilio'
import {
  templateVariant,
  templateContentSid,
  type OwnerAlertType,
  type TemplateLang,
} from './templates'

export function isWhatsAppEnabled(): boolean {
  // Strict: only the literal string 'true' enables it. undefined,
  // 'false', '', '1' → disabled.
  return process.env.WHATSAPP_ENABLED === 'true'
}

export interface WhatsAppSendInput {
  /** Owner phone in E.164 (we add the whatsapp: prefix). */
  to: string
  /** Inside the 24h window → freeform; otherwise → template. */
  sessionOpen: boolean
  /** Freeform body used in-session. */
  freeformBody: string
  /** Alert type + language + positional vars for the out-of-session template. */
  type: OwnerAlertType
  lang: TemplateLang
  variables: string[]
}

export type WhatsAppResult =
  | { ok: true; sid: string; mode: 'freeform' | 'template' }
  | { ok: false; reason: 'disabled' | 'not_configured' | 'no_sender' | 'no_template' | 'send_failed' }

export async function sendWhatsApp(input: WhatsAppSendInput): Promise<WhatsAppResult> {
  if (!isWhatsAppEnabled()) return { ok: false, reason: 'disabled' }
  if (!isTwilioConfigured()) return { ok: false, reason: 'not_configured' }

  const fromRaw = process.env.TWILIO_WHATSAPP_FROM
  if (!fromRaw || !fromRaw.trim()) return { ok: false, reason: 'no_sender' }

  const from = fromRaw.startsWith('whatsapp:') ? fromRaw.trim() : `whatsapp:${fromRaw.trim()}`
  const to = `whatsapp:${input.to}`
  const client = getTwilioClient()

  try {
    if (input.sessionOpen) {
      const msg = await client.messages.create({ from, to, body: input.freeformBody })
      return { ok: true, sid: msg.sid, mode: 'freeform' }
    }

    // Out of session → pre-approved template by Content SID.
    const variant = templateVariant(input.type, input.lang)
    const contentSid = templateContentSid(variant)
    if (!contentSid) return { ok: false, reason: 'no_template' }

    // Meta positional variables: {"1":…,"2":…}
    const contentVariables = JSON.stringify(
      Object.fromEntries(input.variables.map((v, i) => [String(i + 1), v])),
    )
    const msg = await client.messages.create({ from, to, contentSid, contentVariables })
    return { ok: true, sid: msg.sid, mode: 'template' }
  } catch (err) {
    console.error('[notify/whatsapp] send failed:', err instanceof Error ? err.message : String(err))
    return { ok: false, reason: 'send_failed' }
  }
}
