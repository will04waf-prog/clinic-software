import twilio from 'twilio'
import { normalizePhone } from '@/lib/validators'

export function isTwilioConfigured(): boolean {
  return !!(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_PHONE_NUMBER
  )
}

export function getTwilioClient() {
  return twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!)
}

export async function sendSMS(
  to: string,
  body: string
): Promise<{ provider_id: string; status: string } | null> {
  if (!isTwilioConfigured()) {
    console.warn('[sms] Twilio not configured — skipping send')
    return null
  }

  const fromNumber = process.env.TWILIO_PHONE_NUMBER!
  const client = getTwilioClient()

  const e164 = normalizePhone(to)
  if (!e164) {
    console.warn('[sms] Unparseable phone number, skipping send:', to)
    return null
  }

  const message = await client.messages.create({ body, from: fromNumber, to: e164 })

  return {
    provider_id: message.sid,
    status: message.status,
  }
}

// Replace template variables: {{first_name}}, {{clinic_name}}, etc. — case-insensitive
export function renderTemplate(template: string, vars: Record<string, string>) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key.toLowerCase()] ?? `{{${key}}}`)
}
