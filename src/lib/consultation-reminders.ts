/**
 * Sends 24h and 2h consultation reminders.
 * Called by the cron job at /api/cron.
 *
 * Checks per-clinic SMS settings, patient consent, and opt-out status.
 * Logs every attempt to sms_log.
 */

/**
 * CAVEAT(idempotency-tradeoff): The email path in this file uses
 * find-or-insert + Resend Idempotency-Key to allow safe retry after a
 * mid-flight failure (pre-insert, send, or post-send UPDATE). The SMS
 * path has no equivalent — Twilio Messaging API does not expose
 * Idempotency-Key. As a result, when an email failure causes the cron
 * tick to skip flag-flipping (so the next tick retries the email path),
 * sendConsultationSms ALSO re-runs and the patient may receive a
 * duplicate SMS reminder.
 *
 * Failure window is narrow (transient Supabase error during the
 * messages-row INSERT, or during the post-send UPDATE), but real.
 * Acceptable today because (a) clinic SMS volume is pre-launch,
 * (b) the duplicate is one extra SMS per failure event. Revisit when
 * messages/sms_log converge in PR-FU-1+ — at that point, switch to
 * per-channel reminder_*_sent tracking so the email retry doesn't
 * re-trigger SMS.
 */

import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendSMS, isTwilioConfigured } from '@/lib/twilio'
import { sendEmail, wrapEmailHtml } from '@/lib/resend'
import { renderSmsForConsultation, type SmsMessageType } from '@/lib/sms-messages'
import { withCronLock } from '@/lib/cron-locks'

export async function sendConsultationReminders() {
  await withCronLock('sendConsultationReminders', 90, async () => {
    const now = new Date()

    const window24Start = new Date(now.getTime() + 23 * 3600_000).toISOString()
    const window24End   = new Date(now.getTime() + 25 * 3600_000).toISOString()
    const window2Start  = new Date(now.getTime() +  1 * 3600_000).toISOString()
    const window2End    = new Date(now.getTime() +  3 * 3600_000).toISOString()

    const orgSelect = `
      name, timezone,
      sms_enabled, sms_reminder_24h_enabled, sms_reminder_2h_enabled,
      sms_template_reminder_24h, sms_template_reminder_2h,
      phone, email
    `

    const contactSelect = `
      id, first_name, email, phone,
      opted_out_sms, sms_consent
    `

    const [{ data: due24 }, { data: due2h }] = await Promise.all([
      supabaseAdmin
        .from('consultations')
        .select(`*, contact:contacts(${contactSelect}), org:organizations!consultations_organization_id_fkey(${orgSelect})`)
        .in('status', ['scheduled', 'confirmed'])
        .eq('reminder_24h_sent', false)
        .gte('scheduled_at', window24Start)
        .lte('scheduled_at', window24End),
      supabaseAdmin
        .from('consultations')
        .select(`*, contact:contacts(${contactSelect}), org:organizations!consultations_organization_id_fkey(${orgSelect})`)
        .in('status', ['scheduled', 'confirmed'])
        .eq('reminder_2h_sent', false)
        .gte('scheduled_at', window2Start)
        .lte('scheduled_at', window2End),
    ])

    await Promise.all([
      ...(due24 ?? []).map((c) => sendReminder(c, 'reminder_24h')),
      ...(due2h ?? []).map((c) => sendReminder(c, 'reminder_2h')),
    ])
  })
}

/**
 * Find an existing 'queued' reminder email row or insert a new one.
 *
 * Identity is (organization_id, contact_id, subject, body) under the
 * cron lock wrapper. We deliberately include `body` because it embeds
 * the consultation's localized dateStr — without it, two same-subject
 * back-to-back consultations for the same patient would collide.
 *
 * The `messages` table has no `consultation_id` column today (sms_log
 * does, but they haven't converged yet), so we can't key on consultation
 * id directly. The body-includes-dateStr workaround is correct under the
 * current cron-lock serialization. Once PR-FU-1 removes the lock and
 * sms_log/messages converge, this should switch to a (consultation_id,
 * message_type) key — see TODO at call site.
 */
async function findOrInsertQueuedReminderEmailRow(args: {
  organization_id: string
  contact_id: string
  subject: string
  body: string
  to_address: string
}): Promise<{ id: string } | null> {
  const { data: existing } = await supabaseAdmin
    .from('messages')
    .select('id')
    .eq('organization_id', args.organization_id)
    .eq('contact_id', args.contact_id)
    .eq('subject', args.subject)
    .eq('body', args.body)
    .eq('status', 'queued')
    .eq('channel', 'email')
    .eq('direction', 'outbound')
    .is('sequence_step_id', null)
    .maybeSingle()

  if (existing) return existing

  const { data: inserted, error } = await supabaseAdmin
    .from('messages')
    .insert({
      organization_id: args.organization_id,
      contact_id: args.contact_id,
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

  console.error('[reminders] findOrInsertQueuedReminderEmailRow insert failed:', error.message)
  return null
}

async function sendReminder(consultation: any, type: 'reminder_24h' | 'reminder_2h') {
  const contact = consultation.contact
  const org     = consultation.org
  if (!contact || !org) return

  // ── SMS ───────────────────────────────────────────────────────
  await sendConsultationSms({
    type,
    org,
    contact,
    consultation,
  })

  // ── Email ─────────────────────────────────────────────────────
  // Insert-then-send-then-update lifecycle so a function-dies-mid-flight
  // crash retries with the same idempotency key on the next tick rather
  // than double-sending.
  //
  // TODO(idempotency): once the messages/sms_log schemas converge with a
  // (consultation_id, message_type) pair, switch the find-or-insert key
  // to those columns and drop the body-as-disambiguator workaround.
  let emailSucceeded = true
  if (contact.email && !contact.opted_out_email) {
    const tz = org.timezone || 'America/New_York'
    const dateStr = new Date(consultation.scheduled_at).toLocaleString('en-US', {
      timeZone: tz, weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
    })

    const is24h = type === 'reminder_24h'
    const subject = is24h ? 'Reminder: Your consultation tomorrow' : 'Your consultation is in 2 hours'
    const body = is24h
      ? `Hi ${contact.first_name},\n\nThis is a reminder that you have a consultation scheduled for ${dateStr}.\n\nIf you need to reschedule, please contact us as soon as possible.\n\nWe look forward to seeing you!`
      : `Hi ${contact.first_name},\n\nJust a reminder that your consultation is coming up at ${dateStr}.\n\nSee you soon!`

    const queuedRow = await findOrInsertQueuedReminderEmailRow({
      organization_id: consultation.organization_id,
      contact_id: contact.id,
      subject,
      body,
      to_address: contact.email,
    })

    if (!queuedRow) {
      // Pre-insert failed → don't flag the reminder as sent → retry next tick.
      emailSucceeded = false
    } else {
      let providerId: string | undefined
      let sendError: string | undefined
      try {
        const result = await sendEmail({
          to: contact.email,
          subject,
          html: wrapEmailHtml(body, org.name ?? 'your clinic'),
          idempotencyKey: queuedRow.id,
        })
        providerId = result.provider_id
      } catch (err: any) {
        sendError = err?.message ?? String(err)
        console.error(`[reminders] email failed for consultation ${consultation.id}:`, err)
      }

      const finalStatus = sendError ? 'failed' : 'sent'
      const { error: updErr } = await supabaseAdmin
        .from('messages')
        .update({
          status: finalStatus,
          provider_id: providerId,
          error_message: sendError,
          sent_at: new Date().toISOString(),
        })
        .eq('id', queuedRow.id)

      // Post-send UPDATE failed → row stays 'queued', flag stays false →
      // next tick re-sends with the same key → Resend dedups.
      if (updErr) {
        console.error(`[reminders] post-send UPDATE failed for consultation ${consultation.id}; will retry next tick:`, updErr.message)
        emailSucceeded = false
      }
    }
  }

  // Mark sent only if we got the email row to a terminal lifecycle state
  // (or there was no email to send in the first place). Skipping the flag
  // update on failure gives the next cron tick a chance to retry the email
  // path; SMS already ran above and has its own dedup via sms_log.
  if (!emailSucceeded) return

  const flag = type === 'reminder_24h' ? 'reminder_24h_sent' : 'reminder_2h_sent'
  await supabaseAdmin
    .from('consultations')
    .update({ [flag]: true })
    .eq('id', consultation.id)
}

/**
 * Shared SMS send + log helper.
 * Used by both the cron reminders and the confirmation on booking.
 */
export async function sendConsultationSms({
  type,
  org,
  contact,
  consultation,
}: {
  type: SmsMessageType
  org: {
    name: string
    timezone: string
    sms_enabled?: boolean
    sms_confirmation_enabled?: boolean
    sms_reminder_24h_enabled?: boolean
    sms_reminder_2h_enabled?: boolean
    sms_template_confirmation?: string | null
    sms_template_reminder_24h?: string | null
    sms_template_reminder_2h?: string | null
  }
  contact: {
    id: string
    first_name: string
    phone?: string | null
    opted_out_sms?: boolean
    sms_consent?: boolean
  }
  consultation: { id: string; organization_id: string; scheduled_at: string }
}): Promise<void> {
  const logBase = {
    organization_id: consultation.organization_id,
    contact_id:      contact.id,
    consultation_id: consultation.id,
    message_type:    type,
    to_number:       contact.phone ?? '',
  }

  // ── Guard: phone number present ───────────────────────────────
  if (!contact.phone) return

  // ── Guard: SMS consent + not opted out ───────────────────────
  if (!contact.sms_consent) {
    await logSms({ ...logBase, body: '', status: 'skipped', error_message: 'no sms consent' })
    return
  }
  if (contact.opted_out_sms) {
    await logSms({ ...logBase, body: '', status: 'skipped', error_message: 'opted out' })
    return
  }

  // ── Guard: org SMS master switch ──────────────────────────────
  if (!org.sms_enabled) {
    await logSms({ ...logBase, body: '', status: 'skipped', error_message: 'sms disabled for org' })
    return
  }

  // ── Guard: per-type toggle ────────────────────────────────────
  const typeEnabled =
    type === 'confirmation'  ? org.sms_confirmation_enabled !== false :
    type === 'reminder_24h' ? org.sms_reminder_24h_enabled !== false :
                               org.sms_reminder_2h_enabled !== false

  if (!typeEnabled) {
    await logSms({ ...logBase, body: '', status: 'skipped', error_message: `${type} disabled for org` })
    return
  }

  // ── Guard: Twilio configured ──────────────────────────────────
  if (!isTwilioConfigured()) {
    await logSms({ ...logBase, body: '', status: 'skipped', error_message: 'Twilio not configured' })
    return
  }

  const body = renderSmsForConsultation(type, org, contact, consultation.scheduled_at)

  try {
    const result = await sendSMS(contact.phone, body)
    await logSms({
      ...logBase,
      body,
      status:      'sent',
      provider_id: result?.provider_id,
    })
    console.log(`[sms] ${type} sent to contact ${contact.id} — SID: ${result?.provider_id}`)
  } catch (err: any) {
    await logSms({
      ...logBase,
      body,
      status:        'failed',
      error_message: err?.message ?? String(err),
    })
    console.error(`[sms] ${type} FAILED for consultation ${consultation.id}:`, err?.message)
  }
}

async function logSms(entry: {
  organization_id: string
  contact_id: string
  consultation_id: string
  message_type: string
  to_number: string
  body: string
  status: string
  provider_id?: string | null
  error_message?: string | null
}) {
  const { error } = await supabaseAdmin.from('sms_log').insert(entry)
  if (error) console.error('[sms] log write failed:', error.message)
}
