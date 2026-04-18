import { renderTemplate } from '@/lib/twilio'

export type SmsMessageType = 'confirmation' | 'reminder_24h' | 'reminder_2h'

const DEFAULT_TEMPLATES: Record<SmsMessageType, string> = {
  confirmation:
    'Hi {{first_name}}, your consultation with {{clinic_name}} is confirmed for {{date}} at {{time}}. Reply STOP to opt out.',
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
  scheduledAt: string
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

  return renderTemplate(template, {
    first_name:  contact.first_name,
    clinic_name: org.name,
    date,
    time,
  })
}

export const DEFAULT_TEMPLATE_TEXT = DEFAULT_TEMPLATES
