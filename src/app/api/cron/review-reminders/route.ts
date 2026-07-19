/**
 * Daily cron — one gentle review-request reminder.
 *
 * A customer who didn't answer the day-of "¿cómo quedó el trabajo?"
 * gets exactly ONE follow-up 3+ days later (the incumbents' proven
 * 2-touch cadence). After that we leave them alone: review requests
 * that nag breed 1-star revenge reviews.
 *
 * Window: request sent 3–14 days ago, no review_response, no prior
 * reminder. Re-sends the same job_completed template (out-of-window →
 * template is required). Batch-capped; the next run catches the rest.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requireCronAuth } from '@/lib/cron/require-cron-auth'
import { notifyClient } from '@/lib/notify/client'
import { reviewLinkFromPlaceId } from '@/lib/loop/review-request'

const BATCH = 25

export async function POST(req: NextRequest) {
  const denied = requireCronAuth(req)
  if (denied) return denied

  const now = Date.now()
  const newest = new Date(now - 3 * 86_400_000).toISOString()
  const oldest = new Date(now - 14 * 86_400_000).toISOString()

  const { data: sent, error } = await supabaseAdmin
    .from('activity_log')
    .select('id, organization_id, contact_id, metadata, created_at')
    .eq('action', 'review_request_sent')
    .gte('created_at', oldest)
    .lte('created_at', newest)
    .order('created_at', { ascending: true })
    .limit(200)
  if (error) {
    console.error('[cron/review-reminders] fetch failed:', error.message)
    return NextResponse.json({ error: 'fetch_failed' }, { status: 500 })
  }

  let reminded = 0
  let skipped = 0
  for (const row of sent ?? []) {
    if (reminded >= BATCH) break
    const jobId = (row.metadata as { job_id?: string } | null)?.job_id
    if (!jobId || !row.contact_id) { skipped++; continue }

    // Already answered, or already reminded → leave them alone.
    const [{ data: answered }, { data: priorReminder }] = await Promise.all([
      supabaseAdmin.from('activity_log').select('id')
        .eq('organization_id', row.organization_id)
        .eq('action', 'review_response')
        .eq('metadata->>job_id', jobId)
        .limit(1).maybeSingle(),
      supabaseAdmin.from('activity_log').select('id')
        .eq('organization_id', row.organization_id)
        .eq('action', 'review_request_reminder')
        .eq('metadata->>job_id', jobId)
        .limit(1).maybeSingle(),
    ])
    if (answered || priorReminder) { skipped++; continue }

    const [{ data: org }, { data: contact }] = await Promise.all([
      supabaseAdmin.from('organizations')
        .select('name, google_place_id')
        .eq('id', row.organization_id).single(),
      supabaseAdmin.from('contacts')
        .select('first_name, phone, preferred_language, is_archived')
        .eq('id', row.contact_id).maybeSingle(),
    ])
    // The owner may have cleared their Place ID since — respect that.
    if (!org?.google_place_id || !contact?.phone || contact.is_archived) { skipped++; continue }

    const lang: 'en' | 'es' = contact.preferred_language === 'en' ? 'en' : 'es'
    const firstName = (contact.first_name ?? '').trim() || (lang === 'es' ? 'vecino' : 'neighbor')
    const link = reviewLinkFromPlaceId(org.google_place_id)

    await notifyClient({
      orgId: row.organization_id,
      toPhone: contact.phone,
      lang,
      templateType: 'job_completed',
      variables: [firstName, org.name ?? 'su equipo'],
      smsBody: lang === 'es'
        ? `Hola ${firstName}, le escribe ${org.name}. ¿Quedó contento con el trabajo? Una reseña en Google nos ayuda muchísimo: ${link}`
        : `Hi ${firstName}, this is ${org.name}. Happy with the work? A Google review would help us a lot: ${link}`,
      link,
    })

    await supabaseAdmin.from('activity_log').insert({
      organization_id: row.organization_id,
      contact_id: row.contact_id,
      action: 'review_request_reminder',
      metadata: { job_id: jobId },
    })
    reminded++
  }

  return NextResponse.json({ ok: true, reminded, skipped })
}

export async function GET(req: NextRequest) {
  return POST(req)
}
