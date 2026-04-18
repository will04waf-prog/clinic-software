import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendEmail } from '@/lib/resend'

export async function POST(request: Request) {
  try {
    const body = await request.json()

    const { name, clinic_name, email, phone, preferred_date, notes, source, page_path } = body

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

      const rows = [
        ['Name',           String(name)],
        ['Clinic / Spa',   String(clinic_name)],
        ['Email',          String(email)],
        ['Phone',          phone || '—'],
        ['Preferred Date', preferred_date || '—'],
        ['Notes',          notes || '—'],
        ['Source',         source || 'direct'],
        ['Page',           page_path || '—'],
        ['Submitted At',   submittedAt],
      ]

      const tableRows = rows
        .map(
          ([label, value]) =>
            `<tr>
              <td style="padding:8px 12px;font-weight:600;color:#374151;white-space:nowrap;vertical-align:top;">${label}</td>
              <td style="padding:8px 12px;color:#111827;word-break:break-word;">${value}</td>
            </tr>`
        )
        .join('')

      const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/></head>
<body style="font-family:system-ui,sans-serif;background:#f9fafb;padding:40px 20px;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:40px;box-shadow:0 1px 3px rgba(0,0,0,.08);">
    <p style="margin:0 0 4px 0;font-size:13px;font-weight:600;color:#6366f1;text-transform:uppercase;letter-spacing:.05em;">New Demo Request</p>
    <h1 style="margin:0 0 24px 0;font-size:22px;font-weight:700;color:#111827;">${String(clinic_name)}</h1>
    <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
      <tbody>${tableRows}</tbody>
    </table>
    <div style="margin-top:24px;">
      <a href="https://tarhunna.net/admin/demo-requests" style="display:inline-block;background:#6366f1;color:#fff;font-weight:600;font-size:14px;padding:10px 20px;border-radius:8px;text-decoration:none;">
        View in Admin
      </a>
    </div>
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;"/>
    <p style="font-size:12px;color:#9ca3af;margin:0;">Tarhunna · tarhunna.net</p>
  </div>
</body>
</html>`

      try {
        console.log('[demo] sending admin notification to:', adminEmail)
        const result = await sendEmail({
          to: adminEmail,
          subject: `New demo request from ${String(clinic_name)}`,
          html,
          replyTo: String(email),
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
