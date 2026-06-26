import { renderTemplate } from '@/lib/twilio'

export type SmsMessageType = 'confirmation' | 'reminder_24h' | 'reminder_2h'

const DEFAULT_TEMPLATES: Record<SmsMessageType, string> = {
  // {{manage_url}} renders as the raw URL (no prefix) when provided —
  // keeps the confirmation message under the 160-char single-segment
  // SMS budget for typical clinic names and URLs. For manual bookings
  // and reminder paths that don't sign a token, the placeholder
  // collapses to "", which leaves only the period and a single
  // separating space (handled by collapsing in the renderer).
  confirmation:
    'Hi {{first_name}}, your consultation with {{clinic_name}} is confirmed for {{date}} at {{time}}. {{manage_url}}Reply STOP to opt out.',
  // Reminder templates intentionally omit {{manage_url}} — the
  // reminder cron doesn't sign tokens, and stuffing an empty
  // placeholder there created a permanently-empty string risk.
  // Reschedule lives on the confirmation SMS only.
  reminder_24h:
    'Hi {{first_name}}, reminder: your consultation with {{clinic_name}} is tomorrow at {{time}}. Reply STOP to opt out.',
  reminder_2h:
    'Hi {{first_name}}, your consultation with {{clinic_name}} is in about 2 hours at {{time}}. See you soon! Reply STOP to opt out.',
}

export function getTemplate(
  type: SmsMessageType,
  org: {
    sms_template_confirmation?: string | null
    sms_template_reminder_24h?: string | null
    sms_template_reminder_2h?: string | null
  }
): string {
  const custom =
    type === 'confirmation'  ? org.sms_template_confirmation :
    type === 'reminder_24h' ? org.sms_template_reminder_24h :
                               org.sms_template_reminder_2h
  return (custom?.trim() || DEFAULT_TEMPLATES[type])
}

export function renderSmsForConsultation(
  type: SmsMessageType,
  org: {
    name: string
    timezone: string
    sms_template_confirmation?: string | null
    sms_template_reminder_24h?: string | null
    sms_template_reminder_2h?: string | null
  },
  contact: { first_name: string },
  scheduledAt: string,
  /**
   * Phase 4 W5: when present, expands the {{manage_url}} placeholder
   * to "Manage: <url> " (with a trailing space). When absent — manual
   * bookings, reminders without a token — expands to "" so the
   * sentence reads cleanly. Null and undefined both treated as
   * "no link".
   */
  manageUrl?: string | null,
): string {
  const tz = org.timezone || 'America/New_York'
  const dt = new Date(scheduledAt)

  const date = dt.toLocaleDateString('en-US', {
    timeZone: tz,
    weekday: 'short',
    month:   'short',
    day:     'numeric',
  })

  const time = dt.toLocaleTimeString('en-US', {
    timeZone: tz,
    hour:     'numeric',
    minute:   '2-digit',
  })

  const template = getTemplate(type, org)

  const rendered = renderTemplate(template, {
    first_name:  contact.first_name,
    clinic_name: org.name,
    date,
    time,
    // Trailing space so the URL doesn't butt up against "Reply STOP".
    // When manageUrl is absent, collapse to nothing.
    manage_url:  manageUrl ? `${manageUrl} ` : '',
  })

  // Collapse any double-spaces produced by an empty {{manage_url}}
  // placeholder so the SMS reads naturally regardless of whether a
  // URL was injected.
  return rendered.replace(/  +/g, ' ')
}

export const DEFAULT_TEMPLATE_TEXT = DEFAULT_TEMPLATES
