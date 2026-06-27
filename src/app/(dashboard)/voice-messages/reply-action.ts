'use server'

/**
 * Server action: owner reply-via-SMS from the voice-messages inbox.
 *
 * Layla captures voicemails into voice_messages; the owner can either
 * "Resolve" (archive without responding) or "Reply" — type a one-shot
 * SMS back to the caller. This action is the Reply path.
 *
 * Why a server action rather than a public API route:
 *   - the inbox UI is already a server-rendered owner-only page; an
 *     action keeps the call adjacent to markResolved/reopenMessage and
 *     lets us revalidatePath('/voice-messages') in one place.
 *   - we never expose this surface to anonymous callers — there is no
 *     route to forge against.
 *
 * Authorization model — triple-check, in this order:
 *   1. session present
 *   2. profile.role === 'owner' AND profile.is_active === true
 *      (mirrors the tightened voice_messages RLS from
 *      20260712090000_tighten_voice_messages_rls — RLS alone would
 *      let any org member through; the action layer is the contract)
 *   3. row.organization_id === profile.organization_id (the .eq() on
 *      organization_id in the SELECT is the cross-org boundary)
 *
 * Idempotency / abuse:
 *   - Sending IS the resolution: on success we flip status to
 *     'resolved' and the card collapses in the UI. A second attempt
 *     will fail the "refuse if status === 'resolved'" guard, so the
 *     owner cannot accidentally double-send by mashing the button.
 *   - In-memory rate-limit at 3 attempts / hour keyed by
 *     (org, messageId) catches edge cases where the resolve flip
 *     somehow loses (e.g. concurrent send from two tabs before either
 *     flips). Reuses the booking bucket — single-process today, swap
 *     for Redis when we leave Vercel.
 *
 * SMS body composition:
 *   - prepend "{org.name}: " so the patient sees who is texting them
 *     (Twilio number alone is opaque on most phones).
 *   - append " Reply STOP to opt out." unless the owner already typed
 *     STOP/opt-out/unsubscribe language. TCPA — every outbound
 *     transactional SMS must carry the opt-out instruction.
 *
 * What we DON'T do here (and why):
 *   - we do not write to the `messages` table. voice_messages today
 *     is a separate inbox surface; the contact-timeline thread only
 *     pulls messages where contact_id is set. If/when the
 *     calls-transcript-page cluster links voice_messages → contacts
 *     more aggressively we can add a messages row, but that's a
 *     follow-up — not in this feature's scope.
 *   - we do not check `contact.sms_consent`. The patient initiated
 *     contact by leaving a voicemail asking for a callback; the
 *     callback_preference field on voice_messages is the consent
 *     vehicle for this exchange. We DO still honor opted_out_sms
 *     because a hard STOP overrides everything.
 */

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isTwilioConfigured, sendSMS } from '@/lib/twilio'
import { consume, type RateLimitConfig } from '@/lib/booking/public-rate-limit'

// Max 320 chars in the owner's draft — two SMS segments. We cap UI-side
// too but enforce here because nothing prevents a forged form submit.
const MAX_BODY_CHARS = 320

// Reuse the booking in-memory bucket. The library keys by `${ip}:${scope}`;
// we pass `${orgId}:${messageId}` as the "ip" so accidental bursts on one
// voicemail don't leak quota to other voicemails or other orgs.
const VOICE_REPLY_LIMIT: RateLimitConfig = {
  scope: 'voice_reply',
  limit: 3,
  windowMs: 60 * 60 * 1000, // 3 attempts per hour per (org, messageId)
}

type ActionResult = { ok: true } | { ok: false; error: string }

export async function sendVoiceMessageReply(
  args: { messageId: string; body: string },
): Promise<ActionResult> {
  const { messageId } = args
  const rawBody = (args.body ?? '').trim()

  if (rawBody.length === 0) {
    return { ok: false, error: 'empty_body' }
  }
  if (rawBody.length > MAX_BODY_CHARS) {
    return { ok: false, error: 'body_too_long' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'unauthenticated' }

  // Triple-check: owner role + active. See header for rationale.
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, organization_id, is_active')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'owner' || profile?.is_active !== true) {
    return { ok: false, error: 'not_owner' }
  }
  const orgId = profile.organization_id as string

  // Rate-limit by (org, messageId). Lives BEFORE the row read so a
  // forged messageId still consumes a bucket slot under that key.
  const rl = consume(`${orgId}:${messageId}`, VOICE_REPLY_LIMIT)
  if (!rl.ok) {
    return { ok: false, error: 'rate_limited' }
  }

  // Load the voicemail row scoped to caller's org. supabaseAdmin
  // is intentionally NOT used here — the user-scoped client + the
  // .eq('organization_id', orgId) belt+suspender prevents a row id
  // from a different org slipping through.
  const { data: row, error: rowErr } = await supabase
    .from('voice_messages')
    .select('id, status, caller_phone, contact_id, organization_id')
    .eq('id', messageId)
    .eq('organization_id', orgId)
    .single()
  if (rowErr || !row) {
    return { ok: false, error: 'not_found' }
  }

  // Refuse if already resolved — sending IS the resolution, so a
  // resolved row means either the owner already replied (or hit
  // Resolve to archive without replying) and any further send would
  // be a duplicate the patient cannot match to a context.
  if (row.status === 'resolved') {
    return { ok: false, error: 'already_resolved' }
  }

  // Refuse if we have no caller number to text. UI also disables the
  // Reply button when phone is null — this is defense in depth.
  if (!row.caller_phone) {
    return { ok: false, error: 'no_caller_phone' }
  }

  // If the voicemail was linked to a known contact, honor a hard STOP
  // even though the patient initiated the inbound. Anonymous callers
  // (contact_id null) have no STOP record by definition.
  if (row.contact_id) {
    const { data: contact } = await supabase
      .from('contacts')
      .select('id, opted_out_sms')
      .eq('id', row.contact_id)
      .eq('organization_id', orgId)
      .single()
    if (contact?.opted_out_sms) {
      return { ok: false, error: 'contact_opted_out' }
    }
  }

  // Load org for the prepended name + the master sms kill switch.
  const { data: org } = await supabase
    .from('organizations')
    .select('id, name, sms_enabled')
    .eq('id', orgId)
    .single()
  if (!org) return { ok: false, error: 'org_not_found' }
  if (!org.sms_enabled) {
    return { ok: false, error: 'sms_disabled' }
  }

  if (!isTwilioConfigured()) {
    return { ok: false, error: 'twilio_not_configured' }
  }

  // Render: prepend clinic name, append STOP footer unless already present.
  // The STOP-language test mirrors src/app/api/leads/[id]/send-sms — any
  // mention of STOP / opt out / unsubscribe in the body satisfies TCPA.
  const STOP_FOOTER = ' Reply STOP to opt out.'
  const prefixed = `${org.name}: ${rawBody}`
  const needsStop = !/\b(STOP|opt[\s-]?out|unsubscribe)\b/i.test(prefixed)
  const finalBody = prefixed + (needsStop ? STOP_FOOTER : '')

  let providerId: string | null = null
  let sendError: string | null = null
  try {
    const result = await sendSMS(row.caller_phone, finalBody)
    if (!result) {
      // sendSMS returns null on unparseable phone — already-validated
      // E.164 from Twilio should never trip this, but if it does we
      // surface a generic error rather than throwing.
      sendError = 'send_failed'
    } else {
      providerId = result.provider_id
    }
  } catch (err: unknown) {
    // PHI scrub: do not interpolate err into console — Twilio errors
    // can include the destination number and name. The audit trail
    // lives in sms_log.error_message, which is org-scoped.
    console.error('[voice-messages/reply] sendSMS threw')
    sendError = err instanceof Error ? err.message : 'send_failed'
  }

  const status = sendError ? 'failed' : 'sent'

  // sms_log row — admin client because the policy is read-only for
  // authenticated users. message_type='voice_reply' is a new free-form
  // value (the column has no CHECK constraint — see add-sms-settings.sql).
  // consultation_id=null because no consultation is attached.
  await supabaseAdmin.from('sms_log').insert({
    organization_id: orgId,
    contact_id:      row.contact_id ?? null,
    consultation_id: null,
    message_type:    'voice_reply',
    to_number:       row.caller_phone,
    body:            finalBody,
    status,
    provider_id:     providerId,
    error_message:   sendError,
  })

  // On failure, don't flip status — the owner needs to retry. Log the
  // attempt to activity_log so the failure is visible in audit but
  // leave the voicemail open.
  if (sendError) {
    await supabaseAdmin.from('activity_log').insert({
      organization_id: orgId,
      contact_id:      row.contact_id ?? null,
      action:          'voice_message_reply_failed',
      metadata: {
        voice_message_id: messageId,
        error: sendError,
        char_count: finalBody.length,
      },
    })
    return { ok: false, error: 'send_failed' }
  }

  // Flip to resolved — sending IS the resolution. Use the user-scoped
  // client so the existing voice_messages_owner_only RLS double-checks
  // the role. Conditional .eq('status','open') so a concurrent resolve
  // doesn't trigger a no-op resurrection.
  const { error: updateErr } = await supabase
    .from('voice_messages')
    .update({ status: 'resolved' })
    .eq('id', messageId)
    .eq('organization_id', orgId)
    .eq('status', 'open')
  if (updateErr) {
    // SMS already went out — surface a soft warning but don't fail
    // the owner-visible result. The next page load will re-show the
    // row as open, which is honest about state.
    console.error('[voice-messages/reply] status flip failed after send')
  }

  await supabaseAdmin.from('activity_log').insert({
    organization_id: orgId,
    contact_id:      row.contact_id ?? null,
    action:          'voice_message_replied',
    metadata: {
      voice_message_id: messageId,
      char_count: finalBody.length,
      provider_id: providerId,
    },
  })

  revalidatePath('/voice-messages')
  return { ok: true }
}
