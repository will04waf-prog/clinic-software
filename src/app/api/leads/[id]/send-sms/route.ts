import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isTwilioConfigured, sendSMS, renderTemplate } from '@/lib/twilio'
import { formatProcedure } from '@/lib/utils'

const SendSchema = z.object({
  body:                     z.string().min(1, 'Message body is required').max(1600, 'Message is too long'),
  manual_consent_confirmed: z.boolean().optional(),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: contactId } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id, organization:organizations(id, name)')
    .eq('id', user.id)
    .single()

  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const orgId = profile.organization_id
  const org   = profile.organization as any

  // Explicit org scoping (belt + suspenders with RLS).
  const { data: contact } = await supabase
    .from('contacts_active')
    .select('id, first_name, phone, opted_out_sms, sms_consent, procedure_interest, organization_id')
    .eq('id', contactId)
    .eq('organization_id', orgId)
    .single()

  if (!contact)        return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
  if (!contact.phone)  return NextResponse.json({ error: 'no_phone', message: 'Contact has no phone number on file.' }, { status: 400 })

  // Hard block: STOP'd contacts. No override. Defense-in-depth — UI also disables.
  if (contact.opted_out_sms) {
    return NextResponse.json(
      { error: 'contact_opted_out', message: 'This contact has opted out of SMS messages.' },
      { status: 403 },
    )
  }

  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const parsed = SendSchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const { body: messageBody, manual_consent_confirmed } = parsed.data

  // Consent gate: contact without written consent requires explicit confirmation.
  if (!contact.sms_consent && manual_consent_confirmed !== true) {
    return NextResponse.json(
      { error: 'consent_confirmation_required', message: 'You must confirm consent before sending SMS to this contact.' },
      { status: 400 },
    )
  }

  if (!isTwilioConfigured()) {
    return NextResponse.json(
      { error: 'twilio_not_configured', message: 'SMS is not configured for this environment.' },
      { status: 503 },
    )
  }

  // Merge fields — match the email dialog's set so users have one mental model.
  const procedureName = (contact.procedure_interest ?? [])[0]
    ? formatProcedure((contact.procedure_interest as string[])[0])
    : ''
  const renderedBody = renderTemplate(messageBody, {
    first_name:     contact.first_name,
    clinic_name:    org?.name ?? '',
    procedure_name: procedureName,
  })

  let providerId: string | null = null
  let sendError:  string | null = null

  try {
    const result = await sendSMS(contact.phone, renderedBody)
    if (!result) {
      sendError = 'Failed to send SMS. The phone number may be invalid.'
    } else {
      providerId = result.provider_id
    }
  } catch (err: any) {
    sendError = err?.message ?? 'Failed to send SMS'
  }

  const status = sendError ? 'failed' : 'sent'
  const now    = new Date().toISOString()

  // 1. messages — user-visible Message History card on contact detail page.
  await supabase.from('messages').insert({
    organization_id: orgId,
    contact_id:      contactId,
    channel:         'sms',
    direction:       'outbound',
    status,
    body:            renderedBody,
    to_address:      contact.phone,
    provider_id:     providerId,
    error_message:   sendError,
    sent_at:         status === 'sent' ? now : null,
  })

  // 2. sms_log — internal audit. Uses admin client because the sms_log RLS
  //    policy is read-only for authenticated users (no with-check on insert).
  await supabaseAdmin.from('sms_log').insert({
    organization_id: orgId,
    contact_id:      contactId,
    consultation_id: null,
    message_type:    'manual',
    to_number:       contact.phone,
    body:            renderedBody,
    status,
    provider_id:     providerId,
    error_message:   sendError,
  })

  // 3. activity_log — consent-confirmation trail lives here so we can audit
  //    no-consent overrides later. matches the email path's pattern.
  await supabase.from('activity_log').insert({
    organization_id: orgId,
    contact_id:      contactId,
    action:          'sms_sent',
    metadata: {
      status,
      manual_consent_confirmed: manual_consent_confirmed === true,
      had_written_consent:      contact.sms_consent === true,
    },
  })

  if (status === 'sent') {
    await supabase.from('contacts').update({ last_contacted_at: now }).eq('id', contactId)
  }

  if (sendError) {
    return NextResponse.json({ error: 'sms_send_failed', message: sendError }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
