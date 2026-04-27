/**
 * Automation Engine
 * Enrolls contacts in sequences and processes pending steps.
 * Called from API routes and cron jobs.
 */

import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendSMS, renderTemplate as renderSMS } from '@/lib/twilio'
import { sendEmail, renderTemplate as renderEmail, wrapEmailHtml } from '@/lib/resend'
import { withCronLock } from '@/lib/cron-locks'
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

    const { data: enrollment } = await supabaseAdmin
      .from('contact_sequence_enrollments')
      .insert({
        contact_id: opts.contactId,
        sequence_id: seq.id,
        organization_id: opts.organizationId,
        status: 'active',
        current_step: 0,
        next_step_at: nextStepAt,
      })
      .select(`*, contact:contacts(*), sequence:automation_sequences(*, steps:sequence_steps(*))`)
      .single()

    // If first step has zero delay, execute it immediately instead of waiting for cron
    if (enrollment && firstStep && firstStep.delay_hours === 0) {
      await processEnrollmentStep(enrollment, supabaseAdmin)
    }
  }
}

/**
 * Process all due sequence steps. Called by a cron job every minute.
 * Serialized via cron_locks to prevent overlapping ticks from double-sending.
 */
export async function processDueSteps() {
  await withCronLock('processDueSteps', 90, async () => {
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
  })
}

/**
 * Find an existing 'queued' email row for this (sequence_step, contact)
 * or insert a new one. The row's id is the idempotency key forwarded to
 * Resend, so reusing a queued row on retry guarantees that a function
 * crash between send-success and the post-send UPDATE results in Resend
 * deduplicating on the next tick rather than double-sending.
 *
 * Race recovery (post-PR-FU-1, when the cron lock is gone): if a parallel
 * tick raced us through SELECT→INSERT, the partial unique index
 * `messages_queued_step_contact_email_idx` will reject our INSERT with
 * 23505. We re-SELECT and use whatever row won.
 */
async function findOrInsertQueuedEmailRow(
  supabase: any,
  args: {
    organization_id: string
    contact_id: string
    sequence_step_id: string
    subject: string
    body: string
    to_address: string
  },
): Promise<{ id: string } | null> {
  const { data: existing } = await supabase
    .from('messages')
    .select('id')
    .eq('sequence_step_id', args.sequence_step_id)
    .eq('contact_id', args.contact_id)
    .eq('status', 'queued')
    .eq('channel', 'email')
    .eq('direction', 'outbound')
    .maybeSingle()

  if (existing) return existing

  const { data: inserted, error } = await supabase
    .from('messages')
    .insert({
      organization_id: args.organization_id,
      contact_id: args.contact_id,
      sequence_step_id: args.sequence_step_id,
      channel: 'email',
      direction: 'outbound',
      status: 'queued',
      subject: args.subject,
      body: args.body,
      to_address: args.to_address,
    })
    .select('id')
    .single()

  if (!error) return inserted

  if (error.code === '23505') {
    const { data: raced } = await supabase
      .from('messages')
      .select('id')
      .eq('sequence_step_id', args.sequence_step_id)
      .eq('contact_id', args.contact_id)
      .eq('status', 'queued')
      .eq('channel', 'email')
      .eq('direction', 'outbound')
      .maybeSingle()
    return raced ?? null
  }

  console.error('[automation] findOrInsertQueuedEmailRow insert failed:', error.message)
  return null
}

async function processEnrollmentStep(enrollment: any, supabase: any) {
  const { contact, sequence } = enrollment
  if (!contact || !sequence) return
  // Skip soft-deleted contacts (e.g., Undo Import within 24h).
  // The nested join above uses the base `contacts` table via FK, so we
  // filter in code rather than swap to the contacts_active view.
  if (contact.deleted_at) return

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
    clinic_name: org?.name ?? 'your clinic',
    clinic_phone: org?.phone ?? '',
    clinic_email: org?.email ?? '',
  }

  // ── Email branch: insert-then-send lifecycle ─────────────────
  // We bail out (return without advancing) on pre-insert failure or on
  // post-send UPDATE failure so the next cron tick retries with the
  // same messages.id as idempotency key. Resend dedups for 24h.
  if (step.channel === 'email' && contact.email && !contact.opted_out_email) {
    const subject = renderEmail(step.subject ?? 'Message from {{clinic_name}}', vars)
    const bodyText = renderEmail(step.body, vars)
    const html = wrapEmailHtml(bodyText, org?.name ?? 'your clinic')

    const queuedRow = await findOrInsertQueuedEmailRow(supabase, {
      organization_id: enrollment.organization_id,
      contact_id: contact.id,
      sequence_step_id: step.id,
      subject,
      body: step.body,
      to_address: contact.email,
    })

    // Pre-insert failed → no send happened, no advance → next tick retries.
    if (!queuedRow) return

    let providerId: string | undefined
    let sendError: string | undefined
    try {
      const result = await sendEmail({
        to: contact.email,
        subject,
        html,
        idempotencyKey: queuedRow.id,
      })
      providerId = result.provider_id
    } catch (err: any) {
      sendError = err?.message ?? String(err)
    }

    const finalStatus = sendError ? 'failed' : 'sent'
    const { error: updErr } = await supabase
      .from('messages')
      .update({
        status: finalStatus,
        provider_id: providerId,
        error_message: sendError,
        sent_at: new Date().toISOString(),
      })
      .eq('id', queuedRow.id)

    // Post-send UPDATE failed → row stays 'queued', enrollment stays
    // un-advanced → next tick re-sends with same key → Resend dedups.
    if (updErr) {
      console.error('[automation] post-send UPDATE failed; will retry next tick:', updErr.message)
      return
    }
  } else {
    // ── SMS / fall-through branch (unchanged behavior) ─────────
    let messageResult: { provider_id?: string; status?: string } = {}
    let messageStatus = 'sent'
    let errorMessage: string | undefined

    try {
      if (step.channel === 'sms' && contact.phone && !contact.opted_out_sms) {
        const body = renderSMS(step.body, vars)
        const smsResult = await sendSMS(contact.phone, body)
        if (smsResult === null) {
          messageStatus = 'skipped'
        } else {
          messageResult = smsResult
        }
      }
    } catch (err: any) {
      messageStatus = 'failed'
      errorMessage = err.message
    }

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
  }

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
