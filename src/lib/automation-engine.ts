/**
 * Automation Engine
 * Enrolls contacts in sequences and processes pending steps.
 * Called from API routes and cron jobs.
 */

import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendSMS, renderTemplate as renderSMS } from '@/lib/twilio'
import { sendEmail, renderTemplate as renderEmail, wrapEmailHtml } from '@/lib/resend'
import type { TriggerType } from '@/types'

interface EnrollOptions {
  contactId: string
  triggerType: TriggerType
  organizationId: string
  stageId?: string
}

/**
 * Enroll a contact in all matching active sequences for a given trigger.
 * Uses supabaseAdmin so it works correctly when called fire-and-forget
 * from API routes (no dependency on request-scoped cookies/session).
 */
export async function enrollContact(opts: EnrollOptions) {
  // Find matching sequences
  let query = supabaseAdmin
    .from('automation_sequences')
    .select('id')
    .eq('organization_id', opts.organizationId)
    .eq('trigger_type', opts.triggerType)
    .eq('is_active', true)

  if (opts.triggerType === 'stage_changed' && opts.stageId) {
    query = query.eq('trigger_stage_id', opts.stageId)
  }

  const { data: sequences } = await query

  if (!sequences || sequences.length === 0) return

  for (const seq of sequences) {
    // Avoid double-enrollment
    const { data: existing } = await supabaseAdmin
      .from('contact_sequence_enrollments')
      .select('id')
      .eq('contact_id', opts.contactId)
      .eq('sequence_id', seq.id)
      .eq('status', 'active')
      .maybeSingle()

    if (existing) continue

    // Get first step to set next_step_at
    const { data: firstStep } = await supabaseAdmin
      .from('sequence_steps')
      .select('id, delay_hours')
      .eq('sequence_id', seq.id)
      .order('position', { ascending: true })
      .limit(1)
      .maybeSingle()

    const nextStepAt = firstStep
      ? new Date(Date.now() + firstStep.delay_hours * 60 * 60 * 1000).toISOString()
      : null

    await supabaseAdmin.from('contact_sequence_enrollments').insert({
      contact_id: opts.contactId,
      sequence_id: seq.id,
      organization_id: opts.organizationId,
      status: 'active',
      current_step: 0,
      next_step_at: nextStepAt,
    })
  }
}

/**
 * Process all due sequence steps. Called by a cron job every minute.
 */
export async function processDueSteps() {
  const { data: enrollments } = await supabaseAdmin
    .from('contact_sequence_enrollments')
    .select(`
      *,
      contact:contacts(*),
      sequence:automation_sequences(*, steps:sequence_steps(*))
    `)
    .eq('status', 'active')
    .lte('next_step_at', new Date().toISOString())
    .limit(50)

  if (!enrollments) return

  for (const enrollment of enrollments) {
    try {
      await processEnrollmentStep(enrollment, supabaseAdmin)
    } catch (err) {
      console.error('Error processing enrollment step:', err)
    }
  }
}

async function processEnrollmentStep(enrollment: any, supabase: any) {
  const { contact, sequence } = enrollment
  if (!contact || !sequence) return

  const steps = (sequence.steps as any[]).sort((a, b) => a.position - b.position)
  const step = steps[enrollment.current_step]

  if (!step) {
    // Sequence complete
    await supabase
      .from('contact_sequence_enrollments')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', enrollment.id)
    return
  }

  // Get org for clinic name
  const { data: org } = await supabase
    .from('organizations')
    .select('name, email, phone')
    .eq('id', enrollment.organization_id)
    .single()

  const vars: Record<string, string> = {
    first_name: contact.first_name,
    last_name: contact.last_name ?? '',
    full_name: `${contact.first_name} ${contact.last_name ?? ''}`.trim(),
    clinic_name: org?.name ?? 'Tarhunna',
    clinic_phone: org?.phone ?? '',
    clinic_email: org?.email ?? '',
  }

  let messageResult: { provider_id?: string; status?: string } = {}
  let messageStatus = 'sent'
  let errorMessage: string | undefined

  try {
    if (step.channel === 'sms' && contact.phone && !contact.opted_out_sms) {
      const body = renderSMS(step.body, vars)
      messageResult = await sendSMS(contact.phone, body)
    } else if (step.channel === 'email' && contact.email && !contact.opted_out_email) {
      const subject = renderEmail(step.subject ?? 'Message from {{clinic_name}}', vars)
      const bodyText = renderEmail(step.body, vars)
      const html = wrapEmailHtml(bodyText, org?.name ?? 'Tarhunna')
      messageResult = await sendEmail({ to: contact.email, subject, html })
    }
  } catch (err: any) {
    messageStatus = 'failed'
    errorMessage = err.message
  }

  // Log the message
  await supabase.from('messages').insert({
    organization_id: enrollment.organization_id,
    contact_id: contact.id,
    sequence_step_id: step.id,
    channel: step.channel,
    direction: 'outbound',
    status: messageStatus,
    subject: step.subject,
    body: step.body,
    to_address: step.channel === 'sms' ? contact.phone : contact.email,
    provider_id: messageResult.provider_id,
    error_message: errorMessage,
    sent_at: new Date().toISOString(),
  })

  // Advance to next step
  const nextStepIndex = enrollment.current_step + 1
  const nextStep = steps[nextStepIndex]

  if (!nextStep) {
    await supabase
      .from('contact_sequence_enrollments')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', enrollment.id)
  } else {
    const nextStepAt = new Date(
      Date.now() + nextStep.delay_hours * 60 * 60 * 1000
    ).toISOString()

    await supabase
      .from('contact_sequence_enrollments')
      .update({ current_step: nextStepIndex, next_step_at: nextStepAt })
      .eq('id', enrollment.id)
  }

  // Update contact last_contacted_at
  await supabase
    .from('contacts')
    .update({ last_contacted_at: new Date().toISOString() })
    .eq('id', contact.id)
}
