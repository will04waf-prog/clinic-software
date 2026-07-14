/**
 * Owner-alert notification abstraction — send(owner, message, channel).
 *
 * A single entry point for pushing an owner alert over SMS, WhatsApp,
 * or both, per the org's notification_channel. This is ADDITIVE to the
 * existing email alerts (call-summary / voice-message) — those keep
 * firing; this adds a phone-channel push when the owner has set a
 * mobile (owner_notify_e164) and a channel.
 *
 * Rules:
 *   - No owner_notify_e164 → no-op (email already covers the owner).
 *   - WhatsApp is HARD-GATED by WHATSAPP_ENABLED (default false). When
 *     disabled it is never attempted; a 'whatsapp'-only org still gets
 *     the alert via an SMS fallback so nothing is silently dropped.
 *   - Any WhatsApp failure (or out-of-session with no template, etc.)
 *     falls back to SMS and logs the reason.
 *   - Language: owner_language picks the SMS body (built by the caller)
 *     and the WhatsApp template variant.
 */

import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendSMS } from '@/lib/twilio'
import { sendWhatsApp } from './whatsapp'
import { isSessionOpen } from './session'
import type { OwnerAlertType } from './templates'

export interface OwnerAlertInput {
  organizationId: string
  type: OwnerAlertType
  /** SMS + in-session WhatsApp body, already written in the owner's
   *  language by the caller. PHI-free. */
  smsBody: string
  /** Positional {{1}},{{2}},{{3}} values for the out-of-session
   *  WhatsApp template. PHI-free. */
  templateVariables: string[]
}

export interface NotifyResult {
  /** True iff at least one phone channel (SMS or WhatsApp) actually
   *  delivered. False when there's no owner mobile or every send
   *  failed — the signal the urgent path uses to fall back to email. */
  delivered: boolean
}

/**
 * Push an owner alert on the org's chosen channel(s). Never throws;
 * callers should wrap in after() like the email helpers. Returns
 * whether any phone channel delivered.
 */
export async function notifyOwner(input: OwnerAlertInput): Promise<NotifyResult> {
  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('notification_channel, owner_notify_e164, owner_language, whatsapp_last_inbound_at')
    .eq('id', input.organizationId)
    .maybeSingle()

  const to = org?.owner_notify_e164
  if (!to) return { delivered: false } // no owner mobile → email-only

  const channel: 'sms' | 'whatsapp' | 'both' = (org.notification_channel ?? 'sms') as 'sms' | 'whatsapp' | 'both'
  const lang: 'en' | 'es' = org.owner_language === 'es' ? 'es' : 'en'
  const wantSms = channel === 'sms' || channel === 'both'
  const wantWa = channel === 'whatsapp' || channel === 'both'

  let smsNeeded = wantSms
  let delivered = false

  if (wantWa) {
    const result = await sendWhatsApp({
      to,
      sessionOpen: isSessionOpen(org.whatsapp_last_inbound_at),
      freeformBody: input.smsBody,
      type: input.type,
      lang,
      variables: input.templateVariables,
    })
    if (result.ok) {
      delivered = true
    } else {
      // 'disabled' is the expected pre-launch state — don't shout about
      // it. Any real failure logs and forces an SMS fallback so the
      // owner still gets the alert.
      if (result.reason !== 'disabled') {
        console.warn(`[notify] whatsapp ${result.reason} for org ${input.organizationId} — falling back to SMS`)
      }
      smsNeeded = true // for 'both' already true; for 'whatsapp' this is the fallback
    }
  }

  if (smsNeeded) {
    try {
      const r = await sendSMS(to, input.smsBody, { organizationId: input.organizationId })
      if (r && r.status !== 'skipped') delivered = true
    } catch (err) {
      console.error('[notify] SMS send failed:', err instanceof Error ? err.message : String(err))
    }
  }

  return { delivered }
}
