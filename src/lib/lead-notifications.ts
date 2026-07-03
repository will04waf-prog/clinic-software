/**
 * Lead-capture notifications — closes the two silences around the
 * public capture form:
 *
 *   1. notifyOwnerOfLead — the owner never knew a lead arrived until
 *      they happened to open the app. Now each NEW captured lead
 *      emails the owner (the capture endpoint is rate-limited per
 *      org, which bounds this).
 *   2. sendLeadAck — the patient got dead silence after submitting.
 *      Now they get an acknowledgment: email when they left one,
 *      otherwise a single SMS if they left a phone AND ticked SMS
 *      consent AND the org has SMS enabled.
 *
 * Both are best-effort: they run after the contact row is committed
 * and must never fail the capture request. Callers catch + log.
 */

import { sendEmail, wrapEmailHtml, escapeHtml } from '@/lib/resend'
import { sendSMS, isTwilioConfigured } from '@/lib/twilio'
import { APP_URL, wrap, p, btn } from '@/lib/email/branded'
import { blockedReason } from '@/lib/billing/org-access'
import { getOrgOwner } from '@/lib/org-owner'

export interface CapturedLead {
  contactId: string
  firstName: string
  lastName?: string | null
  email?: string | null
  phone?: string | null
  smsConsent: boolean
  procedureInterest?: string[]
  notes?: string | null
  /** Where the lead came from, for the owner email ('intake form' | 'booking page waitlist'). */
  origin: string
}

export interface LeadOrg {
  id: string
  name: string
  plan_status?: string | null
  trial_ends_at?: string | null
  sms_enabled?: boolean | null
}

/** Owner alert — one email per new lead, straight to the inbox. */
export async function notifyOwnerOfLead(org: LeadOrg, lead: CapturedLead): Promise<void> {
  // Blocked orgs (canceled / lapsed trial) get no notifications: the
  // "Open the lead" CTA points at a page the proxy lockout won't let
  // them reach. The lead row itself is still captured — it's waiting
  // in the CRM if they resubscribe.
  if (blockedReason(org.plan_status, org.trial_ends_at)) return

  const owner = await getOrgOwner(org.id)
  if (!owner) return

  const fullName = [lead.firstName, lead.lastName ?? ''].join(' ').trim()
  const interests = (lead.procedureInterest ?? []).join(', ')
  const lines = [
    `Name: ${fullName}`,
    lead.phone ? `Phone: ${lead.phone}` : '',
    lead.email ? `Email: ${lead.email}` : '',
    interests ? `Interested in: ${interests}` : '',
    lead.notes ? `Notes: ${lead.notes}` : '',
  ].filter(Boolean)

  const html = wrap(`
    ${p(`A new lead just came in via the <strong>${escapeHtml(lead.origin)}</strong>:`)}
    ${lines.map((l) => p(escapeHtml(l))).join('')}
    ${p(`Speed wins here — leads contacted quickly book at far higher rates.`)}
    <p style="margin:24px 0 0 0;">${btn('Open the lead', `${APP_URL}/leads`)}</p>
  `, 'Tarhunna &middot; New-lead alert for your clinic.')

  await sendEmail({
    to: owner.email,
    subject: `New lead: ${fullName}${interests ? ` — ${interests}` : ''}`,
    html,
    // One alert per contact per day even if the endpoint re-fires.
    idempotencyKey: `lead-alert:${lead.contactId}`,
  })
}

/** Patient acknowledgment — email preferred, SMS fallback. */
export async function sendLeadAck(org: LeadOrg, lead: CapturedLead): Promise<void> {
  // Same lockout rule for BOTH channels — the email path previously
  // lacked the gate the SMS path had, so canceled orgs still emailed
  // patients "someone will be in touch shortly" (nobody would be).
  if (blockedReason(org.plan_status, org.trial_ends_at)) return

  const firstName = lead.firstName || 'there'

  if (lead.email) {
    const body = [
      `Hi ${firstName},`,
      `Thanks for reaching out to ${org.name} — your request is in their hands and someone will be in touch shortly.`,
      `If it's time-sensitive, calling the clinic directly is always fastest.`,
    ].join('\n')
    await sendEmail({
      to: lead.email,
      subject: `${org.name} received your request`,
      html: wrapEmailHtml(body, org.name),
      idempotencyKey: `lead-ack:${lead.contactId}`,
    })
    return
  }

  // SMS fallback: single transactional acknowledgment. Consent-gated
  // (form checkbox), org master switch, Twilio config. (Plan lockout
  // already handled at the top for both channels.)
  if (
    lead.phone &&
    lead.smsConsent &&
    org.sms_enabled === true &&
    isTwilioConfigured()
  ) {
    await sendSMS(
      lead.phone,
      `${org.name}: thanks for reaching out! We got your request and will be in touch shortly. Reply STOP to opt out.`,
      { organizationId: org.id },
    )
  }
}
