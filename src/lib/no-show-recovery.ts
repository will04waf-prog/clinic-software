/**
 * No-show recovery — the follow-up a missed appointment never got.
 *
 * When staff mark a consultation no_show, the patient previously
 * heard nothing ever again. This sweep (run from the every-minute
 * /api/cron) sends ONE gentle rebooking nudge per no-show:
 * SMS when permitted, else email, with the clinic's public booking
 * link. Recovering even a fraction of no-shows is direct revenue —
 * the average med-spa visit runs ~$527 (AmSpa 2024).
 *
 * Timing: rows qualify 1–168 hours after they were marked no_show.
 * The 1h grace absorbs staff mis-clicks (status can be flipped back
 * before anything sends); the 7-day cap keeps stale rows from ever
 * blasting. Rows that predate this feature are excluded by the
 * migration backfilling no_show_recovery_sent_at on existing
 * no-shows.
 *
 * Guards (same family as consultation reminders):
 *   - tier: automated_reminders capability (Starter never auto-sends)
 *   - plan lockout via blockedReason (no spend for lapsed orgs)
 *   - SMS: org.sms_enabled + contact consent + not opted out
 *   - CAS claim on no_show_recovery_sent_at, released on send failure
 */

import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendSMS, isTwilioConfigured } from '@/lib/twilio'
import { sendEmail, wrapEmailHtml } from '@/lib/resend'
import { withCronLock } from '@/lib/cron-locks'
import { blockedReason } from '@/lib/billing/org-access'
import { isFeatureAllowedForPlan } from '@/lib/billing/enforce-tier'
import { APP_URL } from '@/lib/email/branded'

interface RecoveryRow {
  id: string
  organization_id: string
  updated_at: string
  contact: {
    id: string
    first_name: string | null
    phone: string | null
    email: string | null
    sms_consent: boolean | null
    opted_out_sms: boolean | null
    opted_out_email: boolean | null
  } | null
  org: {
    name: string
    slug: string
    plan: string | null
    plan_status: string | null
    trial_ends_at: string | null
    sms_enabled: boolean | null
  } | null
}

export async function sendNoShowRecovery(): Promise<{ considered: number; sent: number }> {
  const outcome = { considered: 0, sent: 0 }

  await withCronLock('noShowRecovery', 90, async () => {
    const now = Date.now()
    const oneHourAgo = new Date(now - 60 * 60 * 1000).toISOString()
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString()

    const { data: rows, error } = await supabaseAdmin
      .from('consultations')
      .select(`
        id, organization_id, updated_at,
        contact:contacts(id, first_name, phone, email, sms_consent, opted_out_sms, opted_out_email),
        org:organizations(name, slug, plan, plan_status, trial_ends_at, sms_enabled)
      `)
      .eq('status', 'no_show')
      .is('no_show_recovery_sent_at', null)
      .gte('updated_at', sevenDaysAgo)
      .lte('updated_at', oneHourAgo)
      .limit(50)
    if (error) {
      // THROW, don't swallow: a select failure here (e.g. code deployed
      // before the migration added no_show_recovery_sent_at) must reject
      // the cron job so the main cron's failure alert fires — a logged
      // return would skip the sweep silently every minute.
      throw new Error(`[no-show-recovery] select failed: ${error.message}`)
    }

    for (const raw of (rows ?? []) as unknown as RecoveryRow[]) {
      outcome.considered++
      try {
        const contact = Array.isArray(raw.contact) ? raw.contact[0] : raw.contact
        const org = Array.isArray(raw.org) ? raw.org[0] : raw.org
        if (!contact || !org) continue

        // Tier + lockout gates BEFORE the claim: an ineligible row stays
        // unstamped, so if the org upgrades (or resubscribes) within the
        // 7-day window, recovery still goes out. The cost is re-scanning
        // ineligible rows each tick until they age past the window —
        // they're already in the ≤50-row select either way, so the
        // rescan is an in-memory skip, not extra I/O.
        const eligible =
          isFeatureAllowedForPlan(org.plan, 'automated_reminders') &&
          !blockedReason(org.plan_status, org.trial_ends_at)
        if (!eligible) continue

        // CAS claim — one recovery message per no-show, ever.
        const claimIso = new Date().toISOString()
        const { data: claimed } = await supabaseAdmin
          .from('consultations')
          .update({ no_show_recovery_sent_at: claimIso })
          .eq('id', raw.id)
          .is('no_show_recovery_sent_at', null)
          .select('id')
          .maybeSingle()
        if (!claimed) continue

        // Re-read status right before sending — staff may have flipped
        // it back (mis-click) or rebooked inside the grace window.
        const { data: fresh } = await supabaseAdmin
          .from('consultations')
          .select('status')
          .eq('id', raw.id)
          .maybeSingle()
        if (fresh?.status !== 'no_show') continue

        const firstName = contact.first_name?.trim() || 'there'
        const bookUrl = `${APP_URL}/book/${org.slug}`

        const canSms =
          !!contact.phone &&
          contact.sms_consent === true &&
          contact.opted_out_sms !== true &&
          org.sms_enabled === true &&
          isTwilioConfigured()

        let sent = false
        let channel: 'sms' | 'email' | null = null
        if (canSms) {
          const smsBody = `Hi ${firstName}, sorry we missed you at ${org.name}! Life happens — grab a new time that works: ${bookUrl} Reply STOP to opt out.`
          try {
            await sendSMS(contact.phone as string, smsBody, { organizationId: raw.organization_id })
            sent = true
            channel = 'sms'
            await supabaseAdmin.from('sms_log').insert({
              organization_id: raw.organization_id,
              contact_id: contact.id,
              consultation_id: raw.id,
              message_type: 'no_show_recovery',
              to_number: contact.phone,
              body: smsBody,
              status: 'sent',
            })
          } catch (err) {
            console.error(`[no-show-recovery] SMS failed for consultation ${raw.id}:`, err instanceof Error ? err.message : err)
            await supabaseAdmin.from('sms_log').insert({
              organization_id: raw.organization_id,
              contact_id: contact.id,
              consultation_id: raw.id,
              message_type: 'no_show_recovery',
              to_number: contact.phone,
              body: smsBody,
              status: 'failed',
              error_message: err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500),
            })
          }
        }
        if (!sent && contact.email && contact.opted_out_email !== true) {
          try {
            await sendEmail({
              to: contact.email,
              subject: `We missed you at ${org.name} — want to rebook?`,
              html: wrapEmailHtml(
                [
                  `Hi ${firstName},`,
                  `Sorry we missed you! Life happens — if you'd like to grab a new time, the calendar is right here: ${bookUrl}`,
                  `See you soon,`,
                  org.name,
                ].join('\n'),
                org.name,
              ),
              idempotencyKey: `no-show-recovery:${raw.id}`,
            })
            sent = true
            channel = 'email'
          } catch (err) {
            console.error(`[no-show-recovery] email failed for consultation ${raw.id}:`, err instanceof Error ? err.message : err)
          }
        }

        if (sent) {
          outcome.sent++
          await supabaseAdmin.from('activity_log').insert({
            organization_id: raw.organization_id,
            contact_id: contact.id,
            action: 'no_show_recovery_sent',
            metadata: { consultation_id: raw.id, channel },
          })
        } else {
          // Nothing sendable (no consented phone, no email) — release
          // the claim is pointless (still nothing to send next tick);
          // leave it stamped so the row stops re-scanning.
          console.log(`[no-show-recovery] consultation ${raw.id}: no sendable channel, stamped without send`)
        }
      } catch (err) {
        console.error(`[no-show-recovery] failed for consultation ${raw.id}:`, err instanceof Error ? err.message : err)
      }
    }
  })

  return outcome
}
