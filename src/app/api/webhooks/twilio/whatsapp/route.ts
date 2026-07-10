/**
 * POST /api/webhooks/twilio/whatsapp — Multi-vertical Phase 3.
 *
 * Twilio calls this when the OWNER sends us a WhatsApp message
 * (including their "OK" reply to the job_summary template). Its only
 * job is to open the 24-hour WhatsApp session by stamping
 * organizations.whatsapp_last_inbound_at, so later owner alerts can go
 * out freeform instead of as templates.
 *
 * SECURITY (rider 1): this is a state-changing endpoint, so we validate
 * X-Twilio-Signature exactly like the voice + SMS webhooks and reject
 * unsigned/forged requests with 403 — no anonymous stamping.
 *
 * The message body is intentionally ignored; we never act on its
 * contents. Session tracking is org-level and assumes a single owner
 * WhatsApp number (owner_notify_e164) — see src/lib/notify/session.ts.
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { verifyTwilioSignature, twimlResponse } from '@/lib/twilio'
import { normalizePhone } from '@/lib/validators'
import { stampWhatsAppInbound } from '@/lib/notify/session'

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'

export async function POST(req: Request) {
  // Twilio POSTs application/x-www-form-urlencoded.
  const form = await req.formData()
  const params: Record<string, string> = {}
  for (const [k, v] of form.entries()) params[k] = String(v)

  // Rider 1: reject anything not signed by Twilio.
  if (!verifyTwilioSignature(req, params)) {
    console.warn('[twilio-whatsapp] invalid signature')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 403 })
  }

  // From arrives as "whatsapp:+1XXXXXXXXXX" — strip the scheme.
  const fromRaw = (params.From ?? '').replace(/^whatsapp:/i, '')
  const normalized = normalizePhone(fromRaw) ?? fromRaw
  const last10 = normalized.replace(/\D/g, '').slice(-10)

  if (last10.length === 10) {
    // Resolve the org by its owner WhatsApp number. last-10 match makes
    // this robust to stored-format differences (same pattern as
    // persist-call's contact resolution).
    const { data: orgs } = await supabaseAdmin
      .from('organizations')
      .select('id, owner_notify_e164')
      .ilike('owner_notify_e164', `%${last10}`)
      .limit(5)
    const match = (orgs ?? []).find(
      o => (o.owner_notify_e164 ?? '').replace(/\D/g, '').slice(-10) === last10,
    )
    if (match) {
      await stampWhatsAppInbound(match.id)
    } else {
      // A WhatsApp from a number we don't recognize as any owner —
      // valid Twilio request, just nothing to stamp. 200 so Twilio
      // doesn't retry.
      console.warn('[twilio-whatsapp] no org for inbound owner number')
    }
  }

  return twimlResponse(EMPTY_TWIML)
}
