import twilio from 'twilio'

const accountSid = process.env.TWILIO_ACCOUNT_SID!
const authToken = process.env.TWILIO_AUTH_TOKEN!
const fromNumber = process.env.TWILIO_PHONE_NUMBER!

export function getTwilioClient() {
  return twilio(accountSid, authToken)
}

export async function sendSMS(to: string, body: string) {
  const client = getTwilioClient()

  // Normalize phone number
  const normalized = to.replace(/\D/g, '')
  const e164 = normalized.startsWith('1') ? `+${normalized}` : `+1${normalized}`

  const message = await client.messages.create({
    body,
    from: fromNumber,
    to: e164,
  })

  return {
    provider_id: message.sid,
    status: message.status,
  }
}

// Replace template variables: {{first_name}}, {{clinic_name}}, etc. — case-insensitive
export function renderTemplate(template: string, vars: Record<string, string>) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key.toLowerCase()] ?? `{{${key}}}`)
}
