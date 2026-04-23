import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendEmail, renderTemplate, wrapEmailHtml } from '@/lib/resend'
import { formatProcedure } from '@/lib/utils'
import { z } from 'zod'

const SendSchema = z.object({
  subject: z.string().min(1, 'Subject is required'),
  body:    z.string().min(1, 'Message body is required'),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: contactId } = await params
  const supabase = await createClient()

  // Auth
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

  // Verify contact belongs to this org
  const { data: contact } = await supabase
    .from('contacts_active')
    .select('id, first_name, email, organization_id, procedure_interest')
    .eq('id', contactId)
    .eq('organization_id', orgId)
    .single()

  if (!contact)       return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
  if (!contact.email) return NextResponse.json({ error: 'Contact has no email address' }, { status: 400 })

  // Validate input
  const rawBody = await request.json()
  const parsed  = SendSchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const { subject, body } = parsed.data

  // Resolve merge fields
  const procedureName = (contact.procedure_interest ?? [])[0]
    ? formatProcedure((contact.procedure_interest as string[])[0])
    : ''

  const vars = {
    first_name:     contact.first_name,
    clinic_name:    org.name,
    procedure_name: procedureName,
  }

  const renderedSubject = renderTemplate(subject, vars)
  const renderedBody    = renderTemplate(body, vars)
  const html            = wrapEmailHtml(renderedBody, org.name)

  // Send
  let providerId: string | null = null
  let sendError:  string | null = null

  try {
    const result = await sendEmail({ to: contact.email, subject: renderedSubject, html })
    providerId = result.provider_id ?? null
  } catch (err: any) {
    sendError = err.message ?? 'Failed to send'
  }

  const status = sendError ? 'failed' : 'sent'
  const now    = new Date().toISOString()

  // Persist message
  await supabase.from('messages').insert({
    organization_id: orgId,
    contact_id:      contactId,
    channel:         'email',
    direction:       'outbound',
    status,
    subject:         renderedSubject,
    body,
    to_address:      contact.email,
    provider_id:     providerId,
    error_message:   sendError,
    sent_at:         status === 'sent' ? now : null,
  })

  // Log activity
  await supabase.from('activity_log').insert({
    organization_id: orgId,
    contact_id:      contactId,
    action:          'email_sent',
    metadata:        { subject: renderedSubject, status },
  })

  // Bump last_contacted_at
  if (status === 'sent') {
    await supabase
      .from('contacts')
      .update({ last_contacted_at: now })
      .eq('id', contactId)
  }

  if (sendError) {
    return NextResponse.json({ error: sendError }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
