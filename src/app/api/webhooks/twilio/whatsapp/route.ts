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

import { NextResponse, after } from 'next/server'

// after() work is bounded by the route's duration budget — the voice-
// estimate pipeline (media download + STT + LLM + inserts) legitimately
// runs 15-60s, and a platform-default cap would kill it mid-flight with
// no draft AND no reply. Same precedent as cron/weekly-digest.
export const maxDuration = 300
import { supabaseAdmin } from '@/lib/supabase/admin'
import { verifyTwilioSignature, twimlResponse } from '@/lib/twilio'
import { normalizePhone } from '@/lib/validators'
import { stampWhatsAppInbound } from '@/lib/notify/session'
import { classifyReviewReply, handleReviewReply } from '@/lib/loop/review-request'
import { attributeClientInbound, persistInboundWhatsApp } from '@/lib/loop/wa-inbox'
import { handleOwnerVoiceNote } from '@/lib/loop/voice-estimate'

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
      // Voice-note → draft estimate ("mándele una nota de voz a
      // Layla"). Only OWNER-sent audio takes this path; the heavy
      // pipeline (download → transcribe → extract → draft) runs in
      // after() so Twilio gets its 200 immediately. The stamp above
      // opened the owner's 24h session, so the pipeline's reply can
      // go freeform.
      const numMedia = Number(params.NumMedia ?? 0)
      if (numMedia > 0 && (params.MediaContentType0 ?? '').startsWith('audio/') && params.MediaUrl0) {
        after(() => handleOwnerVoiceNote({
          orgId: match.id,
          ownerE164: normalized,
          mediaUrl: params.MediaUrl0!,
          contentType: params.MediaContentType0!,
          caption: params.Body?.trim() || null,
          messageSid: params.MessageSid ?? null,
        }))
      }
    } else {
      // Not an owner number → it's a CUSTOMER replying to something we
      // sent (integrations build 2026-07-18). First stop: the review
      // star-gate — a quick-reply tap (ButtonPayload) or its typed-out
      // text answers a pending review request; happy taps get the
      // Google link, problem taps wake the owner privately.
      const reply = classifyReviewReply(params.ButtonPayload, params.Body)
      const consumed = reply ? await handleReviewReply(normalized, reply, params.MessageSid) : false

      // Two-way inbox: every attributable client message lands on the
      // contact's thread — including review-button taps, which are part
      // of the conversation history. This is also what opens the
      // contact's 24h freeform window for owner replies.
      const attributed = await attributeClientInbound(normalized)
      if (attributed) {
        await persistInboundWhatsApp({
          ...attributed,
          fromE164: normalized,
          body: params.Body ?? params.ButtonText ?? '',
          messageSid: params.MessageSid,
          numMedia: Number(params.NumMedia ?? 0) || 0,
        })
      } else if (!consumed) {
        // Unknown number, no pending review — valid Twilio request,
        // nothing to attach it to. 200 so Twilio doesn't retry.
        console.warn('[twilio-whatsapp] unattributable client inbound')
      }
    }
  }

  return twimlResponse(EMPTY_TWIML)
}
