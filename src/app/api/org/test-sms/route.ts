import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isTwilioConfigured, sendSMS, renderTemplate } from '@/lib/twilio'

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

  // Rate limit: 5 sends per org per hour. Counts every allowed request,
  // including failed Twilio sends — prevents using invalid-number probes
  // to bypass the cap.
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

  const { data: org } = await supabase
    .from('organizations')
    .select('name')
    .eq('id', profile.organization_id)
    .single()

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
