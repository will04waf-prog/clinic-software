import { NextResponse } from 'next/server'
import twilio from 'twilio'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { normalizePhone } from '@/lib/validators'

// Standard SMS keyword classes per Twilio guidance + common carrier conventions.
// Matching is exact-match against the lowercased, trimmed body.
const OPT_OUT_KEYWORDS = new Set(['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit'])
const OPT_IN_KEYWORDS  = new Set(['start', 'yes', 'unstop'])

const EMPTY_TWIML   = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'
const TWIML_HEADERS = { 'Content-Type': 'text/xml; charset=utf-8' }

function emptyTwimlResponse() {
  return new NextResponse(EMPTY_TWIML, { headers: TWIML_HEADERS })
}

export async function POST(request: Request) {
  const authToken = process.env.TWILIO_AUTH_TOKEN
  if (!authToken) {
    console.error('[twilio-inbound] TWILIO_AUTH_TOKEN missing')
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }

  // Twilio POSTs application/x-www-form-urlencoded.
  const formData = await request.formData()
  const params: Record<string, string> = {}
  for (const [k, v] of formData.entries()) {
    params[k] = String(v)
  }

  // Reconstruct the public URL Twilio originally signed. request.url may
  // report the internal Vercel hostname behind the edge — prefer the
  // forwarded headers so the URL matches what Twilio signed.
  const proto = request.headers.get('x-forwarded-proto') ?? 'https'
  const host  = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? ''
  const path  = new URL(request.url).pathname
  const url   = `${proto}://${host}${path}`

  const signature = request.headers.get('x-twilio-signature') ?? ''
  if (!twilio.validateRequest(authToken, signature, url, params)) {
    console.warn(`[twilio-inbound] invalid signature url=${url}`)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 403 })
  }

  const fromRaw   = params.From       ?? ''
  const toRaw     = params.To         ?? ''
  const bodyRaw   = params.Body       ?? ''
  const messageId = params.MessageSid ?? ''
  const bodyLower = bodyRaw.trim().toLowerCase()

  if (!bodyRaw.trim()) {
    console.info(`[twilio-inbound] empty body from=${fromRaw}`)
    return emptyTwimlResponse()
  }

  // ── Normalize From and To ──────────────────────────────────
  const toE164 = normalizePhone(toRaw)
  if (!toE164) {
    console.warn(`[twilio-inbound] unparseable To="${toRaw}" — dropping`)
    return emptyTwimlResponse()
  }
  const fromE164 = normalizePhone(fromRaw)
  if (!fromE164) {
    console.warn(`[twilio-inbound] unparseable From="${fromRaw}" — dropping`)
    return emptyTwimlResponse()
  }
  const last10 = fromE164.replace(/\D/g, '').slice(-10)

  // ── Resolve org by conversation history, not by destination number ──
  // All orgs share a single outbound TWILIO_PHONE_NUMBER, so routing by
  // To (destination) would always resolve to whichever single org claimed
  // that number — defeating multi-tenancy. Instead, find the most recent
  // outbound message TO this From phone; the org that sent it is the
  // org that should receive the reply. Falls back to the legacy
  // organizations.twilio_phone_number lookup for forward compat when
  // orgs eventually get their own per-tenant numbers.
  let orgId: string | null = null

  if (last10.length === 10) {
    const { data: lastOutbound } = await supabaseAdmin
      .from('messages')
      .select('organization_id, to_address')
      .eq('channel', 'sms')
      .eq('direction', 'outbound')
      .ilike('to_address', `%${last10}`)
      .order('created_at', { ascending: false })
      .limit(10)

    // Exact last-10 match in JS (ilike-suffix is permissive about formatting drift).
    const match = (lastOutbound ?? []).find(
      m => (m.to_address ?? '').replace(/\D/g, '').slice(-10) === last10
    )
    if (match) orgId = match.organization_id
  }

  // Legacy fallback: per-org Twilio number, if anyone happens to own it.
  if (!orgId) {
    const { data: legacyOrg } = await supabaseAdmin
      .from('organizations')
      .select('id')
      .eq('twilio_phone_number', toE164)
      .maybeSingle()
    if (legacyOrg) orgId = legacyOrg.id
  }

  if (!orgId) {
    console.warn(`[twilio-inbound] no org found for from=${fromE164} to=${toE164} — dropping`)
    return emptyTwimlResponse()
  }

  // ── STOP/START opt-out (existing behavior, no short-circuit) ──
  // RPC is unchanged — STOP still opts the patient out wherever their
  // number appears, not just in this org. We fall THROUGH so the STOP
  // text is also recorded in the conversation thread for the clinic owner.
  let optAction: 'opt-out' | 'opt-in' | null = null
  if (OPT_OUT_KEYWORDS.has(bodyLower))     optAction = 'opt-out'
  else if (OPT_IN_KEYWORDS.has(bodyLower)) optAction = 'opt-in'

  if (optAction && last10.length === 10) {
    const { error: rpcError } = await supabaseAdmin.rpc(
      'set_sms_opt_out_by_phone_suffix',
      { p_phone_suffix: last10, p_opt_out: optAction === 'opt-out' }
    )
    if (rpcError) {
      // Return 500 so Twilio retries on genuine DB failures.
      console.error(`[twilio-inbound] opt RPC error from=${fromRaw} action=${optAction}:`, rpcError.message)
      return NextResponse.json({ error: rpcError.message }, { status: 500 })
    }
    console.info(`[twilio-inbound] opt action=${optAction} from=${fromRaw}`)
  }

  // ── Dedup by MessageSid ────────────────────────────────────
  // Twilio retries on non-2xx; the unique partial index on messages.provider_id
  // is the real guard, this check just avoids the constraint-violation path.
  if (messageId) {
    const { data: existing } = await supabaseAdmin
      .from('messages')
      .select('id')
      .eq('provider_id', messageId)
      .maybeSingle()
    if (existing) {
      console.info(`[twilio-inbound] dedup MessageSid=${messageId} already stored`)
      return emptyTwimlResponse()
    }
  }

  // ── Find or auto-create contact in this org ───────────────
  // Match by last-10 of phone suffix (insulates from formatting drift across
  // contact_imports). Search uses ilike + JS exact-compare. Active contacts
  // only — archived ones don't claim future inbounds.
  let contactId: string | null = null
  if (last10.length === 10) {
    const { data: candidates } = await supabaseAdmin
      .from('contacts')
      .select('id, phone')
      .eq('organization_id', orgId)
      .eq('is_archived', false)
      .ilike('phone', `%${last10}`)
      .limit(5)

    const exact = (candidates ?? []).find(
      c => (c.phone ?? '').replace(/\D/g, '').slice(-10) === last10
    )
    contactId = exact?.id ?? null
  }

  let createdContact = false
  if (!contactId) {
    // Look up the org's default pipeline stage for new leads.
    const { data: defaultStage } = await supabaseAdmin
      .from('pipeline_stages')
      .select('id')
      .eq('organization_id', orgId)
      .eq('is_default', true)
      .maybeSingle()

    let stageId = defaultStage?.id ?? null
    if (!stageId) {
      // Fallback to the lowest-position stage if no row is flagged is_default.
      const { data: firstStage } = await supabaseAdmin
        .from('pipeline_stages')
        .select('id')
        .eq('organization_id', orgId)
        .order('position', { ascending: true })
        .limit(1)
        .maybeSingle()
      stageId = firstStage?.id ?? null
    }

    const { data: created, error: createError } = await supabaseAdmin
      .from('contacts')
      .insert({
        organization_id: orgId,
        first_name:      'Unknown (SMS)',
        phone:           fromE164,
        source:          'inbound_sms',
        stage_id:        stageId,
        status:          'lead',
      })
      .select('id')
      .single()

    if (createError || !created) {
      console.error(`[twilio-inbound] auto-create contact failed from=${fromE164}:`, createError?.message)
      return NextResponse.json({ error: createError?.message ?? 'contact_create_failed' }, { status: 500 })
    }
    contactId = created.id
    createdContact = true
    console.info(`[twilio-inbound] auto-created contact ${contactId} org=${orgId} from=${fromE164}`)
  }

  // If we just created the contact AND the inbound is a STOP, the cross-org
  // RPC ran earlier with no row to update. Honor the opt-out on the new row.
  if (createdContact && optAction === 'opt-out') {
    await supabaseAdmin
      .from('contacts')
      .update({ opted_out_sms: true })
      .eq('id', contactId)
  }

  // ── Persist the inbound message ────────────────────────────
  const nowIso = new Date().toISOString()

  const { error: msgError } = await supabaseAdmin
    .from('messages')
    .insert({
      organization_id: orgId,
      contact_id:      contactId,
      channel:         'sms',
      direction:       'inbound',
      status:          'received',
      body:            bodyRaw,
      to_address:      toE164,
      from_address:    fromE164,
      provider_id:     messageId || null,
      sent_at:         nowIso,
    })

  if (msgError) {
    // 23505 = unique-violation on provider_id. A parallel retry beat us;
    // treat as success so Twilio stops retrying.
    if ((msgError as { code?: string }).code === '23505') {
      console.info(`[twilio-inbound] race lost on provider_id=${messageId} — treating as duplicate`)
      return emptyTwimlResponse()
    }
    console.error(`[twilio-inbound] messages insert error:`, msgError.message)
    return NextResponse.json({ error: msgError.message }, { status: 500 })
  }

  // Audit symmetry with outbound send-sms path.
  await supabaseAdmin.from('sms_log').insert({
    organization_id: orgId,
    contact_id:      contactId,
    consultation_id: null,
    message_type:    'inbound',
    to_number:       toE164,
    body:            bodyRaw,
    status:          'received',
    provider_id:     messageId || null,
  })

  await supabaseAdmin.from('activity_log').insert({
    organization_id: orgId,
    contact_id:      contactId,
    action:          'sms_received',
    metadata: {
      channel:    'sms',
      from:       fromE164,
      message_id: messageId || null,
    },
  })

  console.info(`[twilio-inbound] stored inbound msg org=${orgId} contact=${contactId} from=${fromE164}`)
  return emptyTwimlResponse()
}
