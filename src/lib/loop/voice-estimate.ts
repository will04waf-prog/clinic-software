/**
 * Voice-note → draft estimate ("mándele una nota de voz a Layla").
 *
 * The owner — standing in a client's yard — sends a WhatsApp VOICE NOTE
 * to the platform number: "estimado para la señora García, corte de
 * césped cada semana, ciento ochenta al mes". Pipeline:
 *
 *   Twilio media download → ElevenLabs Scribe transcription → Claude
 *   extraction (strict JSON) → contact match → draft estimates row +
 *   line items → freeform WhatsApp reply with the review link.
 *
 * Design decisions (hardened after the 2026-07-21 adversarial review):
 *  - DRAFT only, never auto-send. The owner reviews money before the
 *    client sees it — the AI does the typing, not the deciding.
 *  - Contact match must be UNIQUE and UNCONTRADICTED to proceed. A
 *    spoken phone that matches no contact is treated as evidence of a
 *    NEW client and DISQUALIFIES name matching (the wrong-Maria bug).
 *    Name matching is whole-token only — substring matches produced
 *    unique-but-wrong hits ("Susana" ⊃ "Ana").
 *  - A draft is only created when EVERY line item carries a price:
 *    there is no draft-edit UI yet, so an unpriced draft is a trap
 *    that nudges the owner into sending a $0 estimate.
 *  - Dedupe claim is written BEFORE the long pipeline (Twilio retries
 *    arrive seconds apart; a claim written at the end left a 10-30s
 *    window that produced duplicate drafts and double AI spend).
 *  - Blocked/paused orgs (trial over, canceled) don't run the paid
 *    pipeline — same lockout the app enforces.
 *  - Audio is NOT persisted (privacy; the transcript in activity_log
 *    metadata is the audit trail).
 *  - Never throws; every failure path tries to tell the owner what to
 *    do, falling back from freeform WhatsApp to the notifyOwner ladder.
 */

import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendClientWhatsApp } from '@/lib/loop/wa-inbox'
import { notifyOwner } from '@/lib/notify'
import { isLoopVertical } from '@/lib/vertical/config'
import { blockedReason } from '@/lib/billing/org-access'
import { getAppUrl } from '@/lib/voice-agent/app-url'

const MAX_AUDIO_BYTES = 10 * 1024 * 1024 // WhatsApp caps ~16MB; stay under
const EXTRACT_MODEL = 'claude-sonnet-5' // money-adjacent extraction: accuracy over pennies
const MEDIA_FETCH_TIMEOUT_MS = 20_000
const STT_TIMEOUT_MS = 90_000
const LLM_TIMEOUT_MS = 60_000
const HOURLY_ORG_CAP = 15 // notes/hour/org — cost-amplification brake

// ── Pure helpers (exported for tests) ──────────────────────────────

/** Lowercase, strip diacritics — 'García' and 'garcia' must meet. */
export function normalizeName(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()
}

export interface ContactRow {
  id: string
  first_name: string | null
  last_name: string | null
  phone: string | null
}

/**
 * Whole-token name matching. A contact matches when every spoken token
 * appears as an exact word in the contact's full name (or vice versa —
 * the contact's full name spoken inside a longer phrase). Substring
 * containment is deliberately NOT used: "Susana" must never match
 * "Ana". Honorifics are stripped from the spoken side.
 */
export function matchContactsByName(spoken: string, contacts: ContactRow[]): ContactRow[] {
  const q = normalizeName(spoken)
    .replace(/^(la |el |los |las )?(senora|senor|srta|sra|sr|dona|don|miss|mrs|mr|ms)\.? /, '')
  const qTokens = q.split(/\s+/).filter(t => t.length >= 2)
  if (qTokens.length === 0) return []
  return contacts.filter(c => {
    const fullTokens = normalizeName(`${c.first_name ?? ''} ${c.last_name ?? ''}`)
      .split(/\s+/).filter(t => t.length >= 2)
    if (fullTokens.length === 0) return false
    const fullSet = new Set(fullTokens)
    const qSet = new Set(qTokens)
    const qInFull = qTokens.every(t => fullSet.has(t))
    const fullInQ = fullTokens.every(t => qSet.has(t))
    return qInFull || fullInQ
  })
}

// Tolerant of the ways an LLM actually misfires: explicit nulls,
// stringified numbers, out-of-enum recurrence. Field-level .catch()
// drops a bad value instead of rejecting the whole extraction. Hard
// caps bound a misheard "quinientos mil" at $50k/line.
const lineItemSchema = z.object({
  description: z.string().min(1).max(500),
  quantity: z.coerce.number().positive().max(999).catch(1),
  unit_price_cents: z.coerce.number().int().min(0).max(5_000_000).catch(0),
})
const extractionSchema = z.object({
  not_estimate: z.boolean().nullish().catch(null),
  client_name: z.string().nullish().catch(null),
  client_phone: z.string().nullish().catch(null),
  title: z.string().min(1).max(200).catch('Estimado'),
  line_items: z.array(lineItemSchema).max(20).catch([]),
  notes: z.string().max(2000).nullish().catch(null),
  recurrence: z.enum(['weekly', 'biweekly', 'monthly']).nullish().catch(null),
})
export type Extraction = z.infer<typeof extractionSchema>

/** Parse the model's reply: strip fences, JSON.parse, zod-validate. */
export function parseExtraction(raw: string): Extraction | null {
  const stripped = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const start = stripped.indexOf('{')
  const end = stripped.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const parsed = extractionSchema.safeParse(JSON.parse(stripped.slice(start, end + 1)))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

// ── Transcription (ElevenLabs Scribe) ──────────────────────────────

async function transcribe(mediaUrl: string, contentType: string): Promise<
  { ok: true; text: string } | { ok: false; reason: string }
> {
  const xiKey = process.env.ELEVENLABS_API_KEY
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  if (!xiKey) return { ok: false, reason: 'elevenlabs_key_missing' }
  if (!sid || !token) return { ok: false, reason: 'twilio_not_configured' }

  // Defense-in-depth behind the webhook signature: we attach Twilio
  // credentials to this fetch, so only fetch Twilio-owned hosts.
  // (Dev exception: localhost, for the signed local E2E.)
  let host = ''
  try { host = new URL(mediaUrl).hostname } catch { return { ok: false, reason: 'media_bad_url' } }
  const twilioHost = host === 'api.twilio.com' || host.endsWith('.twilio.com')
  const devHost = process.env.NODE_ENV !== 'production' && (host === 'localhost' || host === '127.0.0.1')
  if (!twilioHost && !devHost) return { ok: false, reason: 'media_host_refused' }

  const auth = Buffer.from(`${sid}:${token}`).toString('base64')
  const mediaRes = await fetch(mediaUrl, {
    headers: { Authorization: `Basic ${auth}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(MEDIA_FETCH_TIMEOUT_MS),
  }).catch(() => null)
  if (!mediaRes?.ok) return { ok: false, reason: `media_${mediaRes?.status ?? 'timeout'}` }
  const declared = Number(mediaRes.headers.get('content-length') ?? 0)
  if (declared > MAX_AUDIO_BYTES) return { ok: false, reason: 'media_too_large' }
  const buf = Buffer.from(await mediaRes.arrayBuffer())
  if (buf.byteLength === 0) return { ok: false, reason: 'media_empty' }
  if (buf.byteLength > MAX_AUDIO_BYTES) return { ok: false, reason: 'media_too_large' }

  const form = new FormData()
  form.append('model_id', 'scribe_v1')
  form.append('file', new Blob([new Uint8Array(buf)], { type: contentType || 'audio/ogg' }), 'note.ogg')

  const sttRes = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: { 'xi-api-key': xiKey },
    body: form,
    signal: AbortSignal.timeout(STT_TIMEOUT_MS),
  }).catch(() => null)
  if (!sttRes?.ok) {
    const detail = sttRes ? await sttRes.text().catch(() => '') : 'timeout'
    console.error('[voice-estimate] scribe failed', sttRes?.status ?? 'timeout', String(detail).slice(0, 200))
    return { ok: false, reason: `stt_${sttRes?.status ?? 'timeout'}` }
  }
  const json = await sttRes.json().catch(() => null) as { text?: string } | null
  const text = (json?.text ?? '').trim()
  if (!text) return { ok: false, reason: 'stt_empty' }
  return { ok: true, text }
}

// ── Extraction (Claude) ────────────────────────────────────────────

async function extract(
  transcript: string,
  caption: string | null,
  services: string[],
): Promise<Extraction | null> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('[voice-estimate] ANTHROPIC_API_KEY missing')
    return null
  }
  const client = new Anthropic({ timeout: LLM_TIMEOUT_MS, maxRetries: 1 })
  const system = [
    'You turn a contractor\'s spoken voice note (Spanish or English, often informal) into a draft estimate as STRICT JSON.',
    'Return ONLY a JSON object, no prose, with keys:',
    '  not_estimate (boolean — true when the note is NOT asking to create an estimate/quote for a client, e.g. a general question, a greeting, a message meant for someone else; when true, all other fields may be null),',
    '  client_name (string|null — the customer\'s name as spoken, without titles like "señora"),',
    '  client_phone (string|null — digits if a phone number was spoken),',
    '  title (short job title in the language spoken, e.g. "Corte de césped semanal"),',
    '  line_items (array of {description, quantity, unit_price_cents}),',
    '  notes (string|null — anything else worth keeping: address, access notes, timing),',
    '  recurrence ("weekly"|"biweekly"|"monthly"|null — "cada semana"=weekly, "quincenal"/"cada dos semanas"=biweekly, "mensual"/"al mes" on a recurring service=monthly).',
    'Prices: convert spoken amounts to INTEGER CENTS ("ciento ochenta dólares" → 18000). If a single total is given for the whole job, make it one line item. If no price is spoken, use unit_price_cents 0.',
    'NEVER invent a price, a name, or a phone number that was not spoken.',
    services.length ? `The business's service list (prefer these words in descriptions when they match): ${services.join(', ')}.` : '',
  ].filter(Boolean).join('\n')

  const user = caption
    ? `Voice note transcript:\n"""${transcript}"""\n\nText caption sent with it:\n"""${caption}"""`
    : `Voice note transcript:\n"""${transcript}"""`

  try {
    const res = await client.messages.create({
      model: EXTRACT_MODEL,
      max_tokens: 1200,
      system,
      messages: [{ role: 'user', content: user }],
    })
    const text = res.content.find(b => b.type === 'text')
    return text && text.type === 'text' ? parseExtraction(text.text) : null
  } catch (err) {
    console.error('[voice-estimate] extraction failed:', err instanceof Error ? err.message : err)
    return null
  }
}

// ── Main pipeline ──────────────────────────────────────────────────

export interface OwnerVoiceNoteInput {
  orgId: string
  /** The owner's own number (reply target). */
  ownerE164: string
  mediaUrl: string
  contentType: string
  caption: string | null
  messageSid: string | null
}

export async function handleOwnerVoiceNote(input: OwnerVoiceNoteInput): Promise<void> {
  try {
    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('name, vertical, owner_language, procedures, plan_status, trial_ends_at')
      .eq('id', input.orgId)
      .maybeSingle()
    if (!org || !isLoopVertical(org.vertical)) return
    const es = org.owner_language !== 'en'
    const appUrl = getAppUrl()

    // Freeform reply on the owner's just-opened session; if that rail
    // is down (WhatsApp disabled, Twilio hiccup), fall back to the
    // notifyOwner ladder so a created draft is never a silent draft.
    const reply = async (text: string) => {
      const sent = await sendClientWhatsApp(input.ownerE164, text)
      if (!sent.ok) {
        await notifyOwner({
          organizationId: input.orgId,
          type: 'job_summary',
          smsBody: text.length > 300 ? `${text.slice(0, 297)}…` : text,
          templateVariables: [org.name ?? 'Tarhunna', es ? 'nota de voz' : 'voice note', `${appUrl}/estimates`],
        })
      }
    }
    const manualLink = `${appUrl}/estimates/new`
    const failText = es
      ? `No pude procesar su nota de voz. Inténtelo otra vez, o cree el estimado aquí: ${manualLink}`
      : `I couldn't process your voice note. Try again, or create the estimate here: ${manualLink}`

    // Paused/locked orgs don't run the paid pipeline.
    if (blockedReason(org.plan_status, org.trial_ends_at)) {
      await reply(es
        ? `Su cuenta está pausada, así que no pude crear el estimado. Reactívela en ${appUrl}/settings y vuelva a intentar.`
        : `Your account is paused, so I couldn't create the estimate. Reactivate it at ${appUrl}/settings and try again.`)
      return
    }

    // Dedupe + cost brake, claimed BEFORE the long pipeline (Twilio
    // retries arrive seconds apart — a claim written at the end left a
    // 10-30s duplicate window). Read-then-insert is adequate at this
    // cadence; the claim row also brakes per-org hourly volume.
    if (input.messageSid) {
      const { data: dup } = await supabaseAdmin
        .from('activity_log')
        .select('id')
        .eq('organization_id', input.orgId)
        .eq('action', 'voice_estimate_draft')
        .eq('metadata->>message_sid', input.messageSid)
        .limit(1)
        .maybeSingle()
      if (dup) return
    }
    const hourAgo = new Date(Date.now() - 3_600_000).toISOString()
    const { count: recentCount } = await supabaseAdmin
      .from('activity_log')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', input.orgId)
      .eq('action', 'voice_estimate_draft')
      .gte('created_at', hourAgo)
    if ((recentCount ?? 0) >= HOURLY_ORG_CAP) {
      await reply(es
        ? 'Recibí muchas notas de voz en la última hora — espere un momento y vuelva a intentar.'
        : 'I received a lot of voice notes in the last hour — wait a bit and try again.')
      return
    }
    const { data: claim } = await supabaseAdmin
      .from('activity_log')
      .insert({
        organization_id: input.orgId,
        action: 'voice_estimate_draft',
        metadata: { message_sid: input.messageSid, status: 'processing' },
      })
      .select('id')
      .single()
    const finishClaim = async (metadata: Record<string, unknown>) => {
      if (!claim) return
      await supabaseAdmin
        .from('activity_log')
        .update({ metadata: { message_sid: input.messageSid, ...metadata } })
        .eq('id', claim.id)
    }

    // 1. Transcribe.
    const stt = await transcribe(input.mediaUrl, input.contentType)
    if (!stt.ok) {
      console.error('[voice-estimate] transcription failed:', stt.reason)
      await finishClaim({ status: 'failed', reason: stt.reason })
      await reply(failText)
      return
    }

    // 2. Extract.
    const services = Array.isArray(org.procedures) ? (org.procedures as string[]) : []
    const draft = await extract(stt.text, input.caption, services)
    if (!draft) {
      await finishClaim({ status: 'failed', reason: 'extraction', transcript: stt.text.slice(0, 1000) })
      await reply(es
        ? `Le escuché, pero no logré armar un estimado con eso. Esto entendí:\n\n"${stt.text}"\n\nCréelo manual aquí: ${manualLink}`
        : `I heard you, but couldn't build an estimate from it. Here's what I understood:\n\n"${stt.text}"\n\nCreate it manually here: ${manualLink}`)
      return
    }

    // Not an estimate at all → gentle pointer, no draft, no burn.
    if (draft.not_estimate || draft.line_items.length === 0) {
      await finishClaim({ status: 'not_estimate', transcript: stt.text.slice(0, 1000) })
      await reply(es
        ? 'Recibí su nota de voz. Si quería crear un estimado, mándeme otra diciéndome el cliente, el trabajo y el precio — y yo le armo el borrador.'
        : 'Got your voice note. If you wanted an estimate, send another telling me the client, the job, and the price — and I\'ll draft it for you.')
      return
    }

    // No draft-edit UI exists yet, so an unpriced draft is a trap that
    // nudges the owner into sending a $0 estimate. Require every line
    // to carry a price; otherwise hand back the transcript.
    if (draft.line_items.some(li => li.unit_price_cents === 0)) {
      await finishClaim({ status: 'missing_prices', transcript: stt.text.slice(0, 1000) })
      await reply(es
        ? `Entendí el trabajo pero me faltó el precio. Mándeme la nota otra vez CON el precio, o cree el estimado aquí: ${manualLink}\n\nLo que entendí:\n"${stt.text}"`
        : `I got the job but no price. Send the note again WITH the price, or create the estimate here: ${manualLink}\n\nWhat I understood:\n"${stt.text}"`)
      return
    }

    // 3. Match the client — must be UNIQUE and UNCONTRADICTED.
    const { data: contacts } = await supabaseAdmin
      .from('contacts')
      .select('id, first_name, last_name, phone')
      .eq('organization_id', input.orgId)
      .eq('is_archived', false)
      .order('created_at', { ascending: false })
      .limit(1000)
    let match: ContactRow | null = null
    const spokenDigits = (draft.client_phone ?? '').replace(/\D/g, '')
    const phoneSpoken = spokenDigits.length >= 10
    if (phoneSpoken) {
      const last10 = spokenDigits.slice(-10)
      const byPhone = (contacts ?? []).filter(
        c => (c.phone ?? '').replace(/\D/g, '').slice(-10) === last10,
      )
      if (byPhone.length === 1) match = byPhone[0]!
      // A spoken phone that matches nobody (or several) is DISQUALIFYING
      // evidence — likely a NEW client. Never fall back to name-only
      // matching against it (the wrong-Maria bug).
    } else if (draft.client_name) {
      const byName = matchContactsByName(draft.client_name, contacts ?? [])
      if (byName.length === 1) match = byName[0]!
    }

    if (!match) {
      const who = draft.client_name ?? (es ? 'ese cliente' : 'that client')
      await finishClaim({ status: 'no_match', transcript: stt.text.slice(0, 1000) })
      await reply(es
        ? `Entendí el trabajo, pero no pude identificar a "${who}" con seguridad en sus clientes. Agréguelo o cree el estimado aquí: ${manualLink}\n\nLo que entendí:\n"${stt.text}"`
        : `I got the job, but couldn't confidently identify "${who}" among your clients. Add them or create the estimate here: ${manualLink}\n\nWhat I understood:\n"${stt.text}"`)
      return
    }

    // 4. Create the draft: RPC numbering + app-side totals + org id on
    //    every line item (the estimates API contract for admin inserts).
    const { data: num, error: numErr } = await supabaseAdmin
      .rpc('next_document_number', { p_org: input.orgId, p_kind: 'estimate' })
    if (numErr || typeof num !== 'number') {
      console.error('[voice-estimate] numbering failed:', numErr?.message)
      await finishClaim({ status: 'failed', reason: 'numbering' })
      await reply(failText)
      return
    }
    const subtotal = draft.line_items.reduce((s, li) => s + Math.round(li.quantity * li.unit_price_cents), 0)
    const { data: est, error: insErr } = await supabaseAdmin
      .from('estimates')
      .insert({
        organization_id: input.orgId,
        contact_id: match.id,
        estimate_number: num,
        status: 'draft',
        title: draft.title,
        notes: draft.notes ?? null,
        subtotal_cents: subtotal,
        tax_cents: 0,
        total_cents: subtotal,
        recurrence: draft.recurrence ?? null,
      })
      .select('id')
      .single()
    if (insErr || !est) {
      console.error('[voice-estimate] insert failed:', insErr?.message)
      await finishClaim({ status: 'failed', reason: 'insert' })
      await reply(failText)
      return
    }
    const { error: liErr } = await supabaseAdmin.from('estimate_line_items').insert(
      draft.line_items.map((li, i) => ({
        estimate_id: est.id,
        organization_id: input.orgId,
        description: li.description,
        quantity: li.quantity,
        unit_price_cents: li.unit_price_cents,
        position: i,
      })),
    )
    if (liErr) {
      // Keep the API route's manual-rollback contract: no orphan headers.
      console.error('[voice-estimate] line items failed:', liErr.message)
      await supabaseAdmin.from('estimates').delete().eq('id', est.id)
      await finishClaim({ status: 'failed', reason: 'line_items' })
      await reply(failText)
      return
    }

    // 5. Audit + tell the owner (recurrence spelled out — it flows to
    //    the job on approval, so the owner must know the AI set it).
    await finishClaim({
      status: 'created',
      matched: true,
      contact_id: match.id,
      estimate_id: est.id,
      estimate_number: num,
      transcript: stt.text.slice(0, 1000),
    })
    const clientName = [match.first_name, match.last_name].filter(Boolean).join(' ')
    const total = (subtotal / 100).toFixed(2)
    const detailUrl = `${appUrl}/estimates/${est.id}`
    const recurrenceNote = draft.recurrence
      ? (es
          ? `\nSe repite: ${draft.recurrence === 'weekly' ? 'semanal' : draft.recurrence === 'biweekly' ? 'quincenal' : 'mensual'}.`
          : `\nRepeats: ${draft.recurrence}.`)
      : ''
    await reply(es
      ? `✅ Borrador listo: "${draft.title}" para ${clientName} — $${total}.${recurrenceNote}\n\nRevíselo y mándelo aquí: ${detailUrl}`
      : `✅ Draft ready: "${draft.title}" for ${clientName} — $${total}.${recurrenceNote}\n\nReview and send it here: ${detailUrl}`)
  } catch (err) {
    console.error('[voice-estimate] pipeline error:', err instanceof Error ? err.message : err)
  }
}
