/**
 * GET/POST /api/clients/[id]/whatsapp — the contact's WhatsApp thread.
 *
 * GET  → { messages, windowOpen, lastInboundAt, whatsappEnabled }
 * POST → { body } sends a freeform reply INSIDE the contact's 24h
 *        window (Meta's rule); outside it returns 409 window_closed and
 *        the UI explains instead of failing silently.
 *
 * Auth: cookie client — the org_isolation RLS policy on messages +
 * contacts scopes every read/insert to the caller's org, and any org
 * member may use the thread (the whole point is the spouse/foreman
 * answering from the web while the owner mows).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { whatsappWindowFor, sendClientWhatsApp } from '@/lib/loop/wa-inbox'
import { isWhatsAppEnabled } from '@/lib/notify/whatsapp'
import { clientMessagingBlocked } from '@/lib/notify/kill-switch'

const MAX_BODY = 1000

async function resolveContact(supabase: Awaited<ReturnType<typeof createClient>>, contactId: string) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const

  const { data: contact } = await supabase
    .from('contacts')
    .select('id, organization_id, first_name, phone')
    .eq('id', contactId)
    .maybeSingle()
  if (!contact) return { error: NextResponse.json({ error: 'not_found' }, { status: 404 }) } as const
  return { contact } as const
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const resolved = await resolveContact(supabase, id)
  if ('error' in resolved) return resolved.error
  const { contact } = resolved

  // NEWEST 200, then reverse into chronological order — ascending+limit
  // would pin the thread to the oldest 200 forever once history grows.
  const { data: messages, error } = await supabase
    .from('messages')
    .select('id, direction, status, body, created_at')
    .eq('contact_id', contact.id)
    .eq('channel', 'whatsapp')
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) {
    console.error('[clients/whatsapp] list failed:', error.message)
    return NextResponse.json({ error: 'list_failed' }, { status: 500 })
  }
  messages?.reverse()

  const win = await whatsappWindowFor(contact.organization_id, contact.id)
  return NextResponse.json({
    messages: messages ?? [],
    windowOpen: win.open,
    lastInboundAt: win.lastInboundAt,
    whatsappEnabled: isWhatsAppEnabled(),
    contact: { first_name: contact.first_name, phone: contact.phone },
  })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const resolved = await resolveContact(supabase, id)
  if ('error' in resolved) return resolved.error
  const { contact } = resolved

  if (!contact.phone) return NextResponse.json({ error: 'no_phone' }, { status: 422 })

  const payload = await req.json().catch(() => null) as { body?: unknown } | null
  const body = typeof payload?.body === 'string' ? payload.body.trim() : ''
  if (!body || body.length > MAX_BODY) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }

  // Per-tenant kill switch (shared-sender insurance) — admin-imposed.
  if (await clientMessagingBlocked(contact.organization_id)) {
    return NextResponse.json({ error: 'messaging_blocked' }, { status: 403 })
  }

  // Meta's rule, enforced server-side: freeform only inside the window.
  const win = await whatsappWindowFor(contact.organization_id, contact.id)
  if (!win.open) return NextResponse.json({ error: 'window_closed' }, { status: 409 })

  const sent = await sendClientWhatsApp(contact.phone, body)
  if (!sent.ok) {
    const status = sent.reason === 'disabled' ? 503 : 502
    return NextResponse.json({ error: `whatsapp_${sent.reason}` }, { status })
  }

  // Persist through the cookie client — RLS re-checks the org.
  const { data: row, error: insErr } = await supabase
    .from('messages')
    .insert({
      organization_id: contact.organization_id,
      contact_id: contact.id,
      channel: 'whatsapp',
      direction: 'outbound',
      status: 'sent',
      body,
      to_address: contact.phone,
      from_address: process.env.TWILIO_WHATSAPP_FROM ?? 'whatsapp',
      provider_id: sent.sid,
    })
    .select('id, direction, status, body, created_at')
    .single()
  if (insErr) {
    // The message DID send — log loudly but tell the client it worked.
    console.error('[clients/whatsapp] outbound persist failed:', insErr.message)
  }

  return NextResponse.json({ ok: true, message: row ?? null })
}
