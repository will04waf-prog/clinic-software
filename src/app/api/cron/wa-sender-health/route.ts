/**
 * GET|POST /api/cron/wa-sender-health — every 6h (vercel.json).
 *
 * Shared-sender insurance, half two: watch the platform WhatsApp
 * sender's health so Meta trouble is OURS to discover, not Meta's to
 * enforce. One shared sender means one quality score for every
 * tenant — if it degrades (customer blocks/reports), Meta rate-limits
 * or restricts the number and the whole platform's WhatsApp goes
 * quiet at once. This cron polls Twilio's Senders API and emails the
 * platform admin the moment quality drops below HIGH or the sender
 * leaves ONLINE.
 *
 * Alert dedupe is transport-level: Resend idempotencyKey keyed on
 * (state, UTC date) → at most one email per distinct unhealthy state
 * per day, no DB row needed. Healthy = silence.
 *
 * Defensive parsing: Twilio's v2 Senders API response shapes have
 * shifted; we read quality/status from the documented paths but treat
 * anything unrecognized as "unknown" (reported, never alerting) so an
 * API change degrades to noise in logs, not false pages.
 */

import { NextResponse } from 'next/server'
import { requireCronAuth } from '@/lib/cron/require-cron-auth'
import { isWhatsAppEnabled } from '@/lib/notify/whatsapp'
import { sendEmail, wrapEmailHtml } from '@/lib/resend'

const HEALTHY_QUALITY = new Set(['HIGH', 'GREEN', 'UNKNOWN'])
const HEALTHY_STATUS = new Set(['ONLINE', 'APPROVED', 'REGISTERED', 'UNKNOWN'])

type SenderHealth = {
  found: boolean
  quality: string
  status: string
  messagingLimit: string
}

async function fetchSenderHealth(): Promise<SenderHealth | { error: string }> {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  const from = (process.env.TWILIO_WHATSAPP_FROM ?? '').replace(/^whatsapp:/, '')
  if (!sid || !token || !from) return { error: 'twilio_not_configured' }

  const auth = Buffer.from(`${sid}:${token}`).toString('base64')
  const res = await fetch('https://messaging.twilio.com/v2/Channels/Senders?Channel=whatsapp&PageSize=50', {
    headers: { Authorization: `Basic ${auth}` },
    cache: 'no-store',
  })
  if (!res.ok) return { error: `twilio_${res.status}` }
  const json = await res.json().catch(() => null) as { senders?: unknown[] } | null
  const list = Array.isArray(json?.senders) ? json!.senders! : []

  const digits = from.replace(/\D/g, '')
  for (const raw of list) {
    const s = raw as Record<string, unknown>
    const identity = String(s.sender_id ?? s.identity ?? '')
    if (!identity.replace(/\D/g, '').endsWith(digits)) continue
    const props = (s.properties ?? {}) as Record<string, unknown>
    return {
      found: true,
      quality: String(props.quality_rating ?? s.quality_rating ?? 'UNKNOWN').toUpperCase(),
      status: String(s.status ?? 'UNKNOWN').toUpperCase(),
      messagingLimit: String(props.messaging_limit ?? 'UNKNOWN'),
    }
  }
  return { found: false, quality: 'UNKNOWN', status: 'UNKNOWN', messagingLimit: 'UNKNOWN' }
}

export async function POST(request: Request) {
  const denied = requireCronAuth(request)
  if (denied) return denied

  // Nothing to watch until WhatsApp is live in this environment.
  if (!isWhatsAppEnabled()) return NextResponse.json({ skipped: 'whatsapp_disabled' })

  const health = await fetchSenderHealth()
  if ('error' in health) {
    console.error('[wa-sender-health] fetch failed:', health.error)
    return NextResponse.json({ ok: false, error: health.error }, { status: 502 })
  }

  const unhealthy =
    !health.found ||
    !HEALTHY_QUALITY.has(health.quality) ||
    !HEALTHY_STATUS.has(health.status)

  if (unhealthy) {
    const adminEmail = process.env.ADMIN_NOTIFY_EMAIL
    if (adminEmail) {
      const state = health.found ? `${health.quality}/${health.status}` : 'SENDER_NOT_FOUND'
      const day = new Date().toISOString().slice(0, 10)
      try {
        await sendEmail({
          to: adminEmail,
          subject: `⚠️ WhatsApp sender health: ${state}`,
          html: wrapEmailHtml(
            [
              `The platform WhatsApp sender needs attention.`,
              `Quality rating: ${health.quality}`,
              `Status: ${health.status}`,
              `Messaging limit: ${health.messagingLimit}`,
              ``,
              `One shared sender serves every tenant — a degraded rating rate-limits the whole platform. Check Twilio Console → Messaging → Senders, and consider blocking the offending tenant from /admin/accounts (kill switch).`,
            ].join('\n'),
            'Tarhunna Platform',
          ),
          // One email per unhealthy state per day.
          idempotencyKey: `wa-sender-health:${state}:${day}`,
        })
      } catch {
        console.error('[wa-sender-health] alert email failed')
      }
    } else {
      console.error('[wa-sender-health] unhealthy but ADMIN_NOTIFY_EMAIL unset', health)
    }
  }

  return NextResponse.json({ ok: true, ...health, unhealthy })
}

export async function GET(request: Request) {
  return POST(request)
}
