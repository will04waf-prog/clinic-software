/**
 * Branded owner-facing email building blocks — the Tarhunna header
 * card, paragraph, and button styles. Extracted from trial-reminders
 * (the original home) so every owner lifecycle email (trial reminders,
 * welcome, weekly digest) renders identically.
 *
 * These are for OWNER lifecycle mail. Patient-facing transactional
 * mail (booking confirmations etc.) keeps using wrapEmailHtml in
 * resend.ts — plainer on purpose, it carries the CLINIC's name, not
 * Tarhunna branding.
 */

export const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://tarhunna.net'

export function wrap(content: string, footer = "Tarhunna &middot; You're receiving this because you have a Tarhunna account."): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/></head>
<body style="font-family:system-ui,-apple-system,sans-serif;background:#f9fafb;margin:0;padding:40px 20px;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:40px;box-shadow:0 1px 3px rgba(0,0,0,.08);">
    <p style="font-size:20px;font-weight:900;color:#028090;margin:0 0 28px 0;">Tarhunna</p>
    ${content}
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:32px 0 16px;"/>
    <p style="font-size:12px;color:#9ca3af;margin:0;">${footer}</p>
  </div>
</body>
</html>`
}

export const p = (t: string) =>
  `<p style="margin:0 0 16px 0;line-height:1.7;color:#374151;font-size:15px;">${t}</p>`

export const btn = (text: string, href: string, color = '#028090') =>
  `<a href="${href}" style="display:inline-block;background:${color};color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:14px;">${text}</a>`

/** Big-number stat row for the weekly digest. */
export const statRow = (label: string, value: string, sub?: string) => `
  <tr>
    <td style="padding:10px 0;border-bottom:1px solid #f3f4f6;">
      <span style="font-size:14px;color:#6b7280;">${label}</span>
      ${sub ? `<br/><span style="font-size:12px;color:#9ca3af;">${sub}</span>` : ''}
    </td>
    <td style="padding:10px 0;border-bottom:1px solid #f3f4f6;text-align:right;">
      <span style="font-size:20px;font-weight:800;color:#0B2027;">${value}</span>
    </td>
  </tr>`
