/**
 * Sends 24h and 2h consultation reminders.
 * Called by the cron job.
 */

import { createClient } from '@/lib/supabase/server'
import { sendSMS } from '@/lib/twilio'
import { sendEmail, wrapEmailHtml } from '@/lib/resend'

export async function sendConsultationReminders() {
  const supabase = await createClient()
  const now = new Date()

  // Windows: now+23h→now+25h (24h reminder), now+1h→now+3h (2h reminder)
  const window24Start = new Date(now.getTime() + 23 * 3600_000).toISOString()
  const window24End   = new Date(now.getTime() + 25 * 3600_000).toISOString()
  const window2Start  = new Date(now.getTime() +  1 * 3600_000).toISOString()
  const window2End    = new Date(now.getTime() +  3 * 3600_000).toISOString()

  const [{ data: due24 }, { data: due2h }] = await Promise.all([
    supabase
      .from('consultations')
      .select('*, contact:contacts(*), org:organizations!consultations_organization_id_fkey(name, phone, email)')
      .in('status', ['scheduled', 'confirmed'])
      .eq('reminder_24h_sent', false)
      .gte('scheduled_at', window24Start)
      .lte('scheduled_at', window24End),
    supabase
      .from('consultations')
      .select('*, contact:contacts(*), org:organizations!consultations_organization_id_fkey(name, phone, email)')
      .in('status', ['scheduled', 'confirmed'])
      .eq('reminder_2h_sent', false)
      .gte('scheduled_at', window2Start)
      .lte('scheduled_at', window2End),
  ])

  await Promise.all([
    ...(due24 ?? []).map((c) => sendReminder(c, '24h', supabase)),
    ...(due2h ?? []).map((c) => sendReminder(c, '2h', supabase)),
  ])
}

async function sendReminder(consultation: any, type: '24h' | '2h', supabase: any) {
  const contact = consultation.contact
  const org     = consultation.org
  if (!contact) return

  const dateStr = new Date(consultation.scheduled_at).toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })

  const smsBody = type === '24h'
    ? `Hi ${contact.first_name}, just a reminder that you have a consultation with ${org?.name ?? 'Tarhunna'} tomorrow at ${dateStr}. Reply STOP to opt out.`
    : `Hi ${contact.first_name}, your consultation with ${org?.name ?? 'Tarhunna'} is in about 2 hours (${dateStr}). See you soon!`

  const emailSubject = type === '24h'
    ? `Reminder: Your consultation tomorrow`
    : `Your consultation is in 2 hours`

  const emailBody = type === '24h'
    ? `Hi ${contact.first_name},\n\nThis is a reminder that you have a consultation scheduled for ${dateStr}.\n\nIf you need to reschedule, please contact us as soon as possible.\n\nWe look forward to seeing you!`
    : `Hi ${contact.first_name},\n\nJust a reminder that your consultation is coming up at ${dateStr}.\n\nSee you soon!`

  try {
    if (contact.phone && !contact.opted_out_sms) {
      await sendSMS(contact.phone, smsBody)
    }
    if (contact.email && !contact.opted_out_email) {
      await sendEmail({
        to: contact.email,
        subject: emailSubject,
        html: wrapEmailHtml(emailBody, org?.name ?? 'Tarhunna'),
      })
    }
  } catch (err) {
    console.error(`[reminders] Failed to send ${type} reminder for consultation ${consultation.id}:`, err)
  }

  const flag = type === '24h' ? 'reminder_24h_sent' : 'reminder_2h_sent'
  await supabase
    .from('consultations')
    .update({ [flag]: true })
    .eq('id', consultation.id)
}
