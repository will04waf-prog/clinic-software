import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY!)
const fromEmail = process.env.RESEND_FROM_EMAIL ?? 'noreply@tarhunna.com'

export interface SendEmailParams {
  to: string
  subject: string
  html: string
  replyTo?: string
  /**
   * Required. Pass a unique-per-intended-send key (typically the
   * messages-row id for cron paths, or a fresh randomUUID() for sites
   * that haven't yet been wired into a deterministic lifecycle).
   * Forwarded as the Resend `Idempotency-Key` header; Resend dedups
   * for 24 hours per key.
   */
  idempotencyKey: string
}

export async function sendEmail({ to, subject, html, replyTo, idempotencyKey }: SendEmailParams) {
  const { data, error } = await resend.emails.send(
    { from: fromEmail, to, subject, html, replyTo },
    { idempotencyKey },
  )

  if (error) throw new Error(error.message)

  return { provider_id: data?.id }
}

// Replace {{variables}} in templates — case-insensitive keys
export function renderTemplate(template: string, vars: Record<string, string>) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key.toLowerCase()] ?? `{{${key}}}`)
}

// Minimal HTML wrapper for plain-text style emails
export function wrapEmailHtml(body: string, clinicName = 'your clinic') {
  const paragraphs = body
    .split('\n')
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 16px 0;line-height:1.6;">${p}</p>`)
    .join('')

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/></head>
<body style="font-family:system-ui,sans-serif;background:#f9fafb;padding:40px 20px;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:40px;box-shadow:0 1px 3px rgba(0,0,0,.08);">
    ${paragraphs}
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;"/>
    <p style="font-size:12px;color:#9ca3af;margin:0;">${clinicName}</p>
  </div>
</body>
</html>`
}
