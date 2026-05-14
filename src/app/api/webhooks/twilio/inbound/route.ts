import { NextResponse } from 'next/server'
import twilio from 'twilio'
import { supabaseAdmin } from '@/lib/supabase/admin'

// Standard SMS keyword classes per Twilio guidance + common carrier conventions.
// Matching is exact-match against the lowercased, trimmed body.
const OPT_OUT_KEYWORDS = new Set(['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit'])
const OPT_IN_KEYWORDS  = new Set(['start', 'yes', 'unstop'])

const EMPTY_TWIML   = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'
const TWIML_HEADERS = { 'Content-Type': 'text/xml; charset=utf-8' }

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

  const from = params.From ?? ''
  const body = (params.Body ?? '').trim().toLowerCase()

  if (!body) {
    console.info(`[twilio-inbound] empty body from=${from}`)
    return new NextResponse(EMPTY_TWIML, { headers: TWIML_HEADERS })
  }

  let action: 'opt-out' | 'opt-in' | null = null
  if (OPT_OUT_KEYWORDS.has(body)) action = 'opt-out'
  else if (OPT_IN_KEYWORDS.has(body)) action = 'opt-in'

  if (!action) {
    console.info(`[twilio-inbound] ignored keyword="${body}" from=${from}`)
    return new NextResponse(EMPTY_TWIML, { headers: TWIML_HEADERS })
  }

  // Trailing 10 digits. US/CA numbers (which is all our toll-free can
  // reach) strip cleanly to 10 digits after dropping the country code.
  const last10 = from.replace(/\D/g, '').slice(-10)
  if (last10.length !== 10) {
    console.warn(`[twilio-inbound] non-10-digit From="${from}" action=${action}`)
    return new NextResponse(EMPTY_TWIML, { headers: TWIML_HEADERS })
  }

  const { data: affected, error } = await supabaseAdmin.rpc(
    'set_sms_opt_out_by_phone_suffix',
    { p_phone_suffix: last10, p_opt_out: action === 'opt-out' }
  )

  if (error) {
    // Return 500 so Twilio retries on genuine DB failures.
    console.error(`[twilio-inbound] db error from=${from} action=${action}:`, error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  console.info(`[twilio-inbound] from=${from} action=${action} affected=${affected ?? 0}`)
  return new NextResponse(EMPTY_TWIML, { headers: TWIML_HEADERS })
}
