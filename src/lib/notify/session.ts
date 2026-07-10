/**
 * WhatsApp 24-hour session tracking.
 *
 * Meta's rule: a business may send FREEFORM WhatsApp messages only
 * within 24 hours of the user's most recent inbound message. Outside
 * that window, only pre-approved templates are allowed.
 *
 * We track the window at the ORG level via
 * organizations.whatsapp_last_inbound_at, stamped by the inbound
 * WhatsApp webhook. This assumes a SINGLE owner WhatsApp number per
 * org (the number in owner_notify_e164) — which is the V1 model.
 * Multi-number owners (e.g. several managers each on WhatsApp) are out
 * of scope; supporting them would need a per-number session table.
 */

import { supabaseAdmin } from '@/lib/supabase/admin'

const WINDOW_MS = 24 * 60 * 60 * 1000

/** True if the org is inside its 24h WhatsApp window right now (so a
 *  freeform message is allowed instead of a template). */
export function isSessionOpen(
  lastInboundAt: string | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!lastInboundAt) return false
  const t = Date.parse(lastInboundAt)
  return Number.isFinite(t) && now - t < WINDOW_MS
}

/** Stamp the org's session as freshly opened. Called by the inbound
 *  WhatsApp webhook when the owner messages us (incl. their "OK"). */
export async function stampWhatsAppInbound(
  organizationId: string,
  atIso: string = new Date().toISOString(),
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('organizations')
    .update({ whatsapp_last_inbound_at: atIso })
    .eq('id', organizationId)
  if (error) {
    console.error('[notify/session] failed to stamp whatsapp_last_inbound_at', error.message)
  }
}
