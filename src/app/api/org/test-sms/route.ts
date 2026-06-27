import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isTwilioConfigured, sendSMS, renderTemplate } from '@/lib/twilio'
import { normalizePhone } from '@/lib/validators'

const RATE_WINDOW_MS = 60 * 60 * 1000
const RATE_LIMIT     = 5

// Per-org rate buckets at module scope. Vercel cold starts or redeploys
// reset it — acceptable for a debug feature where the worst case is one
// extra burst window after a deploy.
const sendBuckets = new Map<string, number[]>()

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 4) return phone
  return `•••• •••• ${digits.slice(-4)}`
}

export async function POST(request: Request) {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'invalid_phone', message: 'Phone number is required.' },
      { status: 400 },
    )
  }

  const rawPhone = (body as { phone?: unknown } | null)?.phone
  const phone    = typeof rawPhone === 'string' ? rawPhone.trim() : ''
  if (!phone) {
    return NextResponse.json(
      { error: 'invalid_phone', message: 'Phone number is required.' },
      { status: 400 },
    )
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single()

  if (!profile?.organization_id) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  }

  if (!isTwilioConfigured()) {
    return NextResponse.json(
      { error: 'twilio_not_configured', message: 'SMS is not configured for this environment.' },
      { status: 503 },
    )
  }

  // Org-level SMS kill-switch. The dashboard "send test SMS" button is
  // an explicit owner action, but it must still respect the same
  // master gate that the rest of the SMS pipeline honors — otherwise
  // an org that's been suspended (or simply hasn't toggled SMS on yet)
  // can mint outbound messages from the Twilio number that's pointed
  // at their account.
  const { data: org } = await supabase
    .from('organizations')
    .select('name, sms_enabled')
    .eq('id', profile.organization_id)
    .single()

  if (!org?.sms_enabled) {
    return NextResponse.json(
      { error: 'sms_disabled', message: 'SMS is disabled for this organization. Enable SMS in settings before sending a test message.' },
      { status: 403 },
    )
  }

  // Opt-out check: if the destination phone matches a contact in
  // this org whose opted_out_sms=true, refuse — testing infra does
  // not get to bypass the STOP keyword. When the destination doesn't
  // match any contact at all we allow (the owner is texting their
  // own line / a tester), and the body already self-identifies as a
  // "Test message" so the recipient knows.
  const normalizedDest = normalizePhone(phone)
  const last10         = (normalizedDest ?? phone).replace(/\D/g, '').slice(-10)
  if (last10.length === 10) {
    // Match by last-10 to tolerate formatting drift between the
    // owner's typed input and whatever shape we stored on the
    // contact row.
    const { data: optOutMatches } = await supabase
      .from('contacts')
      .select('id, phone, opted_out_sms')
      .eq('organization_id', profile.organization_id)
      .eq('opted_out_sms', true)
      .ilike('phone', `%${last10}`)
      .limit(5)
    const optedOut = (optOutMatches ?? []).some(
      c => (c.phone ?? '').replace(/\D/g, '').slice(-10) === last10,
    )
    if (optedOut) {
      return NextResponse.json(
        { error: 'recipient_opted_out', message: 'This number has opted out of SMS for your clinic and cannot receive any messages, including tests.' },
        { status: 403 },
      )
    }
  }

  // Rate limit: 5 sends per org per hour. Counts every allowed request,
  // including failed Twilio sends — prevents using invalid-number probes
  // to bypass the cap. Placed AFTER the kill-switch and opt-out checks
  // so failed gate attempts don't burn the bucket.
  const now    = Date.now()
  const cutoff = now - RATE_WINDOW_MS
  const recent = (sendBuckets.get(profile.organization_id) ?? []).filter(t => t > cutoff)
  if (recent.length >= RATE_LIMIT) {
    sendBuckets.set(profile.organization_id, recent)
    return NextResponse.json(
      { error: 'rate_limited', message: 'Too many test messages. Wait an hour before trying again.' },
      { status: 429 },
    )
  }
  recent.push(now)
  sendBuckets.set(profile.organization_id, recent)

  // Body prefix is explicitly "Test message from ..." so the
  // recipient knows this isn't a real clinical message — required
  // when we ALLOW a send to a phone that doesn't match any contact
  // in the org.
  const testMessage = renderTemplate(
    'Test message from {{clinic_name}} on Tarhunna. SMS is working correctly. Reply STOP to opt out.',
    { clinic_name: org?.name ?? 'your clinic' },
  )

  let result: Awaited<ReturnType<typeof sendSMS>>
  try {
    result = await sendSMS(phone, testMessage)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error(`[test-sms] sendSMS threw org=${profile.organization_id}:`, message)
    return NextResponse.json(
      { error: 'sms_send_failed', message: 'Failed to send SMS. Check that the phone number is valid.' },
      { status: 500 },
    )
  }

  if (!result) {
    return NextResponse.json(
      { error: 'sms_send_failed', message: 'Failed to send SMS. Check that the phone number is valid.' },
      { status: 500 },
    )
  }

  return NextResponse.json({
    success:     true,
    sent_to:     maskPhone(phone),
    message_sid: result.provider_id,
  })
}
