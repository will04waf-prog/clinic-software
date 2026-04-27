import { randomUUID } from 'crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendEmail } from '@/lib/resend'

export async function POST(request: Request) {
  try {
    const body = await request.json()

    const { name, clinic_name, email, phone, preferred_date, preferred_time, notes, source, page_path } = body

    if (!name || !clinic_name || !email) {
      return NextResponse.json({ error: 'Name, clinic name, and email are required.' }, { status: 400 })
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 })
    }

    const { error } = await supabaseAdmin
      .from('demo_requests')
      .insert({
        name: String(name).slice(0, 200),
        clinic_name: String(clinic_name).slice(0, 200),
        email: String(email).slice(0, 200),
        phone: phone ? String(phone).slice(0, 50) : null,
        preferred_date: preferred_date ? String(preferred_date).slice(0, 200) : null,
        preferred_time: preferred_time ? String(preferred_time).slice(0, 50) : null,
        notes: notes ? String(notes).slice(0, 2000) : null,
        source: source ? String(source).slice(0, 500) : null,
        page_path: page_path ? String(page_path).slice(0, 500) : null,
        status: 'new',
      })

    if (error) {
      console.error('demo_requests insert error:', error)
      return NextResponse.json({ error: 'Failed to save request.' }, { status: 500 })
    }

    // ── Admin notification email ───────────────────────────────
    const adminEmail = process.env.ADMIN_NOTIFY_EMAIL
    const fromEmail = process.env.RESEND_FROM_EMAIL ?? 'noreply@tarhunna.com'
    const apiKeyPresent = !!process.env.RESEND_API_KEY

    console.log('[demo] email check — ADMIN_NOTIFY_EMAIL:', adminEmail ?? 'NOT SET')
    console.log('[demo] email check — RESEND_FROM_EMAIL:', fromEmail)
    console.log('[demo] email check — RESEND_API_KEY present:', apiKeyPresent)

    if (!adminEmail) {
      console.warn('[demo] ADMIN_NOTIFY_EMAIL is not set — skipping admin notification')
    } else {
      const submittedAt = new Date().toLocaleString('en-US', {
        timeZone: 'America/New_York',
        dateStyle: 'full',
        timeStyle: 'short',
      })

      function field(label: string, value: string | null | undefined, href?: string) {
        const display = value || '—'
        const valueHtml = href && value
          ? `<a href="${href}" style="color:#6366f1;text-decoration:none;">${display}</a>`
          : `<span style="color:${value ? '#111827' : '#9ca3af'};">${display}</span>`
        return `
          <div style="margin-bottom:16px;">
            <div style="font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px;">${label}</div>
            <div style="font-size:15px;line-height:1.5;word-break:break-word;">${valueHtml}</div>
          </div>`
      }

      const preferredDisplay = preferred_date
        ? `${preferred_date}${preferred_time ? ' at ' + preferred_time + ' ET' : ''}`
        : null

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:540px;">

        <!-- Header -->
        <tr><td style="background:#6366f1;border-radius:12px 12px 0 0;padding:24px 28px;">
          <div style="font-size:11px;font-weight:600;color:#c7d2fe;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px;">New Demo Request</div>
          <div style="font-size:22px;font-weight:700;color:#ffffff;line-height:1.2;">${String(clinic_name)}</div>
          <div style="font-size:13px;color:#a5b4fc;margin-top:4px;">${submittedAt}</div>
        </td></tr>

        <!-- Body -->
        <tr><td style="background:#ffffff;padding:28px;border-radius:0 0 12px 12px;">

          <!-- Contact -->
          <div style="margin-bottom:20px;padding-bottom:20px;border-bottom:1px solid #e5e7eb;">
            <div style="font-size:12px;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:.05em;margin-bottom:14px;">Contact</div>
            ${field('Name', String(name))}
            ${field('Email', String(email), `mailto:${String(email)}`)}
            ${field('Phone', phone)}
          </div>

          <!-- Scheduling preference -->
          <div style="margin-bottom:20px;padding-bottom:20px;border-bottom:1px solid #e5e7eb;">
            <div style="font-size:12px;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:.05em;margin-bottom:14px;">Scheduling Preference</div>
            ${field('Preferred Date &amp; Time', preferredDisplay)}
          </div>

          ${notes ? `
          <!-- Notes -->
          <div style="margin-bottom:20px;padding-bottom:20px;border-bottom:1px solid #e5e7eb;">
            <div style="font-size:12px;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:.05em;margin-bottom:14px;">Notes</div>
            <div style="font-size:15px;color:#111827;line-height:1.6;white-space:pre-wrap;">${String(notes)}</div>
          </div>` : ''}

          <!-- Meta -->
          <div style="margin-bottom:24px;">
            <div style="font-size:12px;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:.05em;margin-bottom:14px;">Source</div>
            ${field('Page', page_path)}
            ${field('Referrer', source && source !== 'direct' ? source : null)}
          </div>

          <!-- CTA -->
          <a href="https://tarhunna.net/admin/demo-requests"
             style="display:block;background:#6366f1;color:#ffffff;font-weight:600;font-size:15px;text-align:center;text-decoration:none;padding:14px 20px;border-radius:8px;">
            View in Admin &rarr;
          </a>

          <p style="margin:20px 0 0 0;font-size:12px;color:#9ca3af;text-align:center;">
            Tarhunna &middot; tarhunna.net
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`

      try {
        console.log('[demo] sending admin notification to:', adminEmail)
        // TODO(idempotency): random key — no retry dedup yet for this site.
        // Demo requests are one-shot user submissions; we don't retry. The key
        // only guards against an accidental duplicate POST being deduped by
        // Resend within the 24h window.
        const result = await sendEmail({
          to: adminEmail,
          subject: `Demo request: ${String(clinic_name)} — ${String(name)}`,
          html,
          replyTo: String(email),
          idempotencyKey: randomUUID(),
        })
        console.log('[demo] admin notification sent — Resend id:', result.provider_id)
      } catch (emailErr: any) {
        console.error('[demo] admin notification FAILED')
        console.error('[demo] error message:', emailErr?.message)
        console.error('[demo] full error:', JSON.stringify(emailErr, null, 2))
      }
    }

    return NextResponse.json({ ok: true }, { status: 201 })
  } catch (err) {
    console.error('demo POST error:', err)
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 })
  }
}
