/**
 * Two-way WhatsApp inbox (integrations build 2026-07-18).
 *
 * Client → business messages used to be silently dropped by the inbound
 * webhook (it only stamped the OWNER session). Now they persist as
 * messages rows (channel='whatsapp' — the column is free text, so no
 * migration) attributed to a contact, and the owner answers from a
 * thread on the client record.
 *
 * Attribution: our WhatsApp sender is ONE platform number, so an
 * inbound From can only be matched by contact phone. When two orgs
 * share a customer number (rare but real), the org whose thread most
 * recently touched that number wins; ties fall to the newest contact.
 *
 * The 24h window: Meta only allows freeform business→customer messages
 * within 24h of the CUSTOMER's last inbound. We track it per contact
 * from the messages rows themselves — the same rows the thread renders.
 */

import { supabaseAdmin } from '@/lib/supabase/admin'
import { isWhatsAppEnabled } from '@/lib/notify/whatsapp'
import { getTwilioClient, isTwilioConfigured } from '@/lib/twilio'

const WINDOW_MS = 24 * 60 * 60 * 1000

function waSender(): string | null {
  const raw = process.env.TWILIO_WHATSAPP_FROM
  if (!raw?.trim()) return null
  return raw.startsWith('whatsapp:') ? raw.trim() : `whatsapp:${raw.trim()}`
}

export interface AttributedInbound {
  orgId: string
  contactId: string
}

/** Resolve an inbound client WhatsApp to (org, contact), or null. */
export async function attributeClientInbound(fromE164: string): Promise<AttributedInbound | null> {
  const last10 = fromE164.replace(/\D/g, '').slice(-10)
  if (last10.length !== 10) return null

  const { data: candidates } = await supabaseAdmin
    .from('contacts')
    .select('id, organization_id, phone, created_at')
    .eq('is_archived', false)
    .ilike('phone', `%${last10}`)
    .limit(10)
  const exact = (candidates ?? []).filter(
    c => (c.phone ?? '').replace(/\D/g, '').slice(-10) === last10,
  )
  if (exact.length === 0) return null
  if (exact.length === 1) return { orgId: exact[0]!.organization_id, contactId: exact[0]!.id }

  // Multiple orgs know this number → the one with the most recent
  // WhatsApp thread activity for any of these contacts wins.
  const ids = exact.map(c => c.id)
  const { data: recent } = await supabaseAdmin
    .from('messages')
    .select('contact_id, created_at')
    .eq('channel', 'whatsapp')
    .in('contact_id', ids)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const winner = recent?.contact_id
    ? exact.find(c => c.id === recent.contact_id)
    : [...exact].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))[0]
  if (!winner) return null
  console.warn('[wa-inbox] ambiguous inbound number matched multiple orgs — attributed by recency')
  return { orgId: winner.organization_id, contactId: winner.id }
}

/**
 * Persist an inbound client WhatsApp message. Media isn't downloaded
 * yet (that's the follow-up with its own storage migration) — a
 * media-only message persists as a visible marker so the thread never
 * shows a hole where a photo was.
 */
export async function persistInboundWhatsApp(args: {
  orgId: string
  contactId: string
  fromE164: string
  body: string
  messageSid: string | undefined
  numMedia: number
}): Promise<void> {
  let body = args.body.trim()
  if (args.numMedia > 0) {
    const marker = body ? ` [+${args.numMedia} 📷]` : `[📷 ${args.numMedia === 1 ? 'Foto recibida' : `${args.numMedia} fotos recibidas`} — véala en WhatsApp]`
    body = body + marker
  }
  if (!body) return

  const { error } = await supabaseAdmin.from('messages').insert({
    organization_id: args.orgId,
    contact_id: args.contactId,
    channel: 'whatsapp',
    direction: 'inbound',
    status: 'received',
    body,
    to_address: waSender() ?? 'whatsapp',
    from_address: args.fromE164,
    provider_id: args.messageSid ?? null,
  })
  // 23505 = the unique provider_id guard caught a Twilio retry — fine.
  if (error && error.code !== '23505') {
    console.error('[wa-inbox] inbound persist failed:', error.message)
  }
}

export interface WindowState {
  open: boolean
  lastInboundAt: string | null
}

/** Is the contact's 24h customer-service window open right now? */
export async function whatsappWindowFor(orgId: string, contactId: string): Promise<WindowState> {
  const { data } = await supabaseAdmin
    .from('messages')
    .select('created_at')
    .eq('organization_id', orgId)
    .eq('contact_id', contactId)
    .eq('channel', 'whatsapp')
    .eq('direction', 'inbound')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const lastInboundAt = data?.created_at ?? null
  const open = !!lastInboundAt && Date.now() - new Date(lastInboundAt).getTime() < WINDOW_MS
  return { open, lastInboundAt }
}

export type SendResult =
  | { ok: true; sid: string }
  | { ok: false; reason: 'disabled' | 'not_configured' | 'no_sender' | 'send_failed' }

/** Freeform business→client send. Caller enforces the window. */
export async function sendClientWhatsApp(toE164: string, body: string): Promise<SendResult> {
  if (!isWhatsAppEnabled()) return { ok: false, reason: 'disabled' }
  if (!isTwilioConfigured()) return { ok: false, reason: 'not_configured' }
  const from = waSender()
  if (!from) return { ok: false, reason: 'no_sender' }
  try {
    const msg = await getTwilioClient().messages.create({ from, to: `whatsapp:${toE164}`, body })
    return { ok: true, sid: msg.sid }
  } catch (err) {
    console.error('[wa-inbox] send failed:', err instanceof Error ? err.message : err)
    return { ok: false, reason: 'send_failed' }
  }
}
