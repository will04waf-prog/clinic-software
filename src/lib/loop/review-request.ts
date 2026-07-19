/**
 * Google-review request engine (integrations build 2026-07-18).
 *
 * The growth loop: owner marks a job complete → the customer gets a
 * WhatsApp quick-reply asking how the work turned out (job_completed
 * template) → a happy tap answers with the org's Google review link
 * (freeform — the tap itself opened the 24h window) → an unhappy tap
 * alerts the owner privately BEFORE a bad review lands anywhere public.
 * That star-gate is the whole point: incumbents charge $39-125/mo for
 * exactly this (Jobber Reviews add-on, NiceJob).
 *
 * State lives in activity_log (no schema change):
 *   review_request_sent     {job_id, contact_id, channel, phone_last10}
 *   review_request_reminder {job_id}
 *   review_response         {job_id, contact_id, response: 'ok'|'issue'}
 *
 * Inbound matching keys on the CUSTOMER's phone (phone_last10 in the
 * sent-row metadata), never on the button payload — quick-reply payloads
 * are static per template and cannot carry per-job ids.
 *
 * The review link itself is only ever sent AFTER a happy reply, and via
 * freeform — keeping the registered template link-free protects its
 * UTILITY classification (Meta has paused MARKETING templates to US
 * numbers).
 *
 * SMS fallback (WhatsApp disabled / template unapproved) carries the
 * review link directly in the SMS body — no buttons on that rail. Note
 * the SMS path is still A2P-gated inside notifyClient; when NEITHER
 * channel can deliver, notifyClient reports channel 'none' and we do
 * NOT record the request — the job stays eligible for a real send once
 * a channel comes online.
 */

import { supabaseAdmin } from '@/lib/supabase/admin'
import { notifyClient } from '@/lib/notify/client'
import { notifyOwner } from '@/lib/notify'
import { isWhatsAppEnabled } from '@/lib/notify/whatsapp'
import { getTwilioClient, isTwilioConfigured } from '@/lib/twilio'
import { isLoopVertical } from '@/lib/vertical/config'
import { getAppUrl } from '@/lib/voice-agent/app-url'

// Google Place IDs are opaque base64url-ish tokens (ChIJ…, GhIJ…, Eh…).
const PLACE_ID_RE = /^[A-Za-z0-9_-]{10,255}$/

export function reviewLinkFromPlaceId(placeId: string): string {
  return `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`
}

/**
 * Accepts what an owner will realistically paste: a bare Place ID, the
 * writereview link itself, or any Google URL carrying a placeid/place_id
 * query param. Returns the Place ID, or null when unparseable.
 */
export function parsePlaceIdInput(raw: string): string | null {
  const s = raw.trim()
  if (!s) return null
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s)
      const pid = u.searchParams.get('placeid') ?? u.searchParams.get('place_id')
      return pid && PLACE_ID_RE.test(pid) ? pid : null
    } catch {
      return null
    }
  }
  return PLACE_ID_RE.test(s) ? s : null
}

// ─── Send on job completion ──────────────────────────────────────

/**
 * Fire the review request for a just-completed job. Fire-and-forget
 * (called inside after()); never throws. No-ops unless the org is a
 * loop vertical WITH a Google Place ID configured — the settings card
 * is the feature's on-switch.
 */
export async function sendReviewRequestForJob(orgId: string, jobId: string): Promise<void> {
  try {
    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('name, vertical, google_place_id')
      .eq('id', orgId)
      .single()
    if (!org || !isLoopVertical(org.vertical) || !org.google_place_id) return

    const { data: job } = await supabaseAdmin
      .from('jobs')
      .select('id, contact_id, status')
      .eq('id', jobId)
      .eq('organization_id', orgId)
      .maybeSingle()
    if (!job || job.status !== 'completed' || !job.contact_id) return

    const { data: contact } = await supabaseAdmin
      .from('contacts')
      .select('id, first_name, phone, preferred_language, is_archived')
      .eq('id', job.contact_id)
      .maybeSingle()
    if (!contact?.phone || contact.is_archived) return

    // One request per job, ever. Human-speed writer (a single owner tap)
    // — a lookup guard is sufficient; no race-safe claim index needed.
    const { data: already } = await supabaseAdmin
      .from('activity_log')
      .select('id')
      .eq('organization_id', orgId)
      .eq('action', 'review_request_sent')
      .eq('metadata->>job_id', jobId)
      .limit(1)
      .maybeSingle()
    if (already) return

    const lang: 'en' | 'es' = contact.preferred_language === 'en' ? 'en' : 'es'
    const firstName = (contact.first_name ?? '').trim() || (lang === 'es' ? 'vecino' : 'neighbor')
    const link = reviewLinkFromPlaceId(org.google_place_id)

    const result = await notifyClient({
      orgId,
      toPhone: contact.phone,
      lang,
      templateType: 'job_completed',
      variables: [firstName, org.name ?? 'su equipo'],
      // SMS has no buttons — it carries the review link directly.
      smsBody: lang === 'es'
        ? `Hola ${firstName}, le escribe ${org.name}. Terminamos el trabajo de hoy. Si quedó contento, ¿nos regala una reseña en Google? ${link}`
        : `Hi ${firstName}, this is ${org.name}. We finished today's work. If you're happy with it, would you leave us a Google review? ${link}`,
      link,
    })

    // Nothing delivered (WhatsApp off/unapproved AND SMS gated) → do NOT
    // burn the one-request-per-job guard on a phantom send; the job stays
    // eligible once a channel comes online.
    if (result.channel === 'none') {
      console.info(`[review-request] no channel could deliver for job ${jobId} — not recorded`)
      return
    }

    await supabaseAdmin.from('activity_log').insert({
      organization_id: orgId,
      contact_id: contact.id,
      action: 'review_request_sent',
      metadata: {
        job_id: jobId,
        contact_id: contact.id,
        channel: result.channel,
        phone_last10: contact.phone.replace(/\D/g, '').slice(-10),
      },
    })
  } catch (err) {
    console.error('[review-request] send failed:', err instanceof Error ? err.message : err)
  }
}

// ─── Inbound star-gate ───────────────────────────────────────────

export type ReviewReply = 'ok' | 'issue'

/** Map a quick-reply tap (or its typed-out text) to a gate outcome. */
export function classifyReviewReply(buttonPayload: string | undefined, body: string | undefined): ReviewReply | null {
  if (buttonPayload === 'review_ok') return 'ok'
  if (buttonPayload === 'review_issue') return 'issue'
  const text = (body ?? '').trim().toLowerCase()
  if (text === 'todo excelente' || text === 'all great') return 'ok'
  if (text === 'hubo un problema' || text === 'there was a problem') return 'issue'
  return null
}

async function sendFreeformWhatsApp(toE164: string, body: string): Promise<boolean> {
  if (!isWhatsAppEnabled() || !isTwilioConfigured()) return false
  const fromRaw = process.env.TWILIO_WHATSAPP_FROM
  if (!fromRaw?.trim()) return false
  const from = fromRaw.startsWith('whatsapp:') ? fromRaw.trim() : `whatsapp:${fromRaw.trim()}`
  try {
    await getTwilioClient().messages.create({ from, to: `whatsapp:${toE164}`, body })
    return true
  } catch (err) {
    console.error('[review-request] freeform reply failed:', err instanceof Error ? err.message : err)
    return false
  }
}

/**
 * Handle a customer's reply to the review request. Returns true when the
 * reply matched a pending request and was consumed. Never throws.
 *
 * The customer's tap opened THEIR 24h service window, so the follow-up
 * (review link, or the "we'll make it right" note) goes freeform.
 *
 * `messageSid` (Twilio's inbound id) makes retried webhook deliveries
 * no-ops instead of double-firing the gate's side effects.
 */
export async function handleReviewReply(fromE164: string, reply: ReviewReply, messageSid?: string): Promise<boolean> {
  try {
    const last10 = fromE164.replace(/\D/g, '').slice(-10)
    if (last10.length !== 10) return false

    // Twilio retries webhooks; a retry carries the same MessageSid.
    // Read-then-act is enough here — retries arrive seconds apart, not
    // concurrently.
    if (messageSid) {
      const { data: dup } = await supabaseAdmin
        .from('activity_log')
        .select('id')
        .eq('action', 'review_response')
        .eq('metadata->>message_sid', messageSid)
        .limit(1)
        .maybeSingle()
      if (dup) return true
    }

    // Most recent un-answered request to this phone. 30 days — the
    // request may be up to 14 days old when the CRON reminder goes out,
    // and the customer can take days more to answer THAT.
    const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString()
    const { data: candidates } = await supabaseAdmin
      .from('activity_log')
      .select('id, organization_id, contact_id, metadata, created_at')
      .eq('action', 'review_request_sent')
      .eq('metadata->>phone_last10', last10)
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(5)
    if (!candidates?.length) return false

    let pending: (typeof candidates)[number] | null = null
    for (const c of candidates) {
      const jobId = (c.metadata as { job_id?: string } | null)?.job_id
      if (!jobId) continue
      const { data: answered } = await supabaseAdmin
        .from('activity_log')
        .select('id')
        .eq('organization_id', c.organization_id)
        .eq('action', 'review_response')
        .eq('metadata->>job_id', jobId)
        .limit(1)
        .maybeSingle()
      if (!answered) { pending = c; break }
    }
    if (!pending) return false

    const jobId = (pending.metadata as { job_id?: string }).job_id!
    const [{ data: org }, { data: contact }] = await Promise.all([
      supabaseAdmin
        .from('organizations')
        .select('name, google_place_id, owner_language')
        .eq('id', pending.organization_id)
        .single(),
      pending.contact_id
        ? supabaseAdmin
            .from('contacts')
            .select('first_name, phone, preferred_language')
            .eq('id', pending.contact_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ])
    if (!org) return false

    const lang: 'en' | 'es' = contact?.preferred_language === 'en' ? 'en' : 'es'
    const orgName = org.name ?? 'el equipo'
    const responseRow = {
      organization_id: pending.organization_id,
      contact_id: pending.contact_id,
      action: 'review_response',
      metadata: { job_id: jobId, contact_id: pending.contact_id, response: reply, message_sid: messageSid ?? null },
    }

    if (reply === 'ok') {
      // Deliver the link BEFORE consuming the gate: if Twilio hiccups,
      // we return false, Twilio retries the webhook, and the customer
      // still gets their link instead of the gate closing on silence.
      if (org.google_place_id) {
        const link = reviewLinkFromPlaceId(org.google_place_id)
        const delivered = await sendFreeformWhatsApp(fromE164, lang === 'es'
          ? `¡Gracias! 🙏 Si nos puede regalar una reseña en Google, nos ayuda muchísimo a seguir creciendo: ${link}`
          : `Thank you! 🙏 A quick Google review would help us grow — it only takes a minute: ${link}`)
        if (!delivered) return false
      }
      await supabaseAdmin.from('activity_log').insert(responseRow)
      return true
    }

    // 'issue': consume the gate FIRST (the owner alert below has its own
    // fallbacks; a duplicate owner page would be worse than a lost
    // client-side ack), then reassure the customer and wake the owner —
    // this is the bad review that never made it to Google.
    await supabaseAdmin.from('activity_log').insert(responseRow)
    await sendFreeformWhatsApp(fromE164, lang === 'es'
      ? `Lamentamos mucho eso. ${orgName} se comunicará con usted hoy mismo para arreglarlo.`
      : `We're very sorry to hear that. ${orgName} will reach out today to make it right.`)

    const ownerLang: 'en' | 'es' = org.owner_language === 'es' ? 'es' : 'en'
    const who = (contact?.first_name ?? '').trim() || (ownerLang === 'es' ? 'un cliente' : 'a customer')
    const phone = contact?.phone ?? fromE164
    const scheduleUrl = `${getAppUrl()}/schedule`
    await notifyOwner({
      organizationId: pending.organization_id,
      type: 'job_summary',
      smsBody: ownerLang === 'es'
        ? `Atención: ${who} respondió "Hubo un problema" sobre el trabajo de hoy. Llámelo: ${phone}`
        : `Heads up: ${who} replied "There was a problem" about today's job. Call them: ${phone}`,
      // Template variables stay PHI-free (business, detail, link).
      templateVariables: [
        orgName,
        ownerLang === 'es' ? 'un cliente reportó un problema con el trabajo de hoy' : 'a customer reported a problem with today\'s job',
        scheduleUrl,
      ],
    })
    return true
  } catch (err) {
    console.error('[review-request] reply handling failed:', err instanceof Error ? err.message : err)
    return false
  }
}
