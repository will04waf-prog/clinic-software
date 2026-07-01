/**
 * POST /api/cron/voice-reminder-staleness — Phase 5 W2 hardening.
 *
 * Safety-net for consultations stuck in voice_reminder_status='sent'.
 *
 * Normal flow: the voice-reminders cron places a call and CAS-flips
 * the row to 'sent'. When Vapi sends the end-of-call-report webhook
 * to /api/webhooks/vapi/call-end, that handler maps the disposition
 * onto a terminal status (confirmed / canceled / voicemail / ...).
 *
 * Failure modes:
 *   - Vapi never sent end-of-call-report (assistant not subscribed —
 *     this is the bug that hid call_logs from us until commit b047095).
 *   - Vapi sent it, our webhook 500'd, and Vapi's retry budget was
 *     exhausted before our infra came back.
 *   - Vapi's call placement failed mid-flight after we wrote 'sent'.
 *
 * Without a sweep, these rows sit at 'sent' forever and the owner
 * dashboard reports inaccurate state. This cron looks for rows that
 * are still 'sent' more than 1 hour after voice_reminder_sent_at and
 * forces them to 'no_answer' (the most likely real disposition for
 * a stuck row — typically the call hit voicemail or hung up before
 * the model called post_call_summary_email).
 *
 * Idempotent: the CAS .eq('voice_reminder_status','sent') means a
 * concurrent webhook arrival between our SELECT and UPDATE wins —
 * we'd no-op and the webhook's terminal disposition stands.
 *
 * Cadence: every 30 minutes. The hour-old gate ensures we don't
 * race a slow Vapi webhook on a call that just ended.
 */

import { NextResponse } from 'next/server'
import { requireCronAuth } from '@/lib/cron/require-cron-auth'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { withCronLock } from '@/lib/cron-locks'

interface JobOutcome {
  ok: boolean
  flipped: number
  errors: number
}

export async function sweepStaleReminders(): Promise<JobOutcome & { skipped?: boolean }> {
  const outcome: JobOutcome = { ok: true, flipped: 0, errors: 0 }

  const wrapped = await withCronLock('voice_reminder_staleness', 120, async () => {
    const oneHourAgo = new Date(Date.now() - 3600_000).toISOString()

    const { data: stale, error: selErr } = await supabaseAdmin
      .from('consultations')
      .select('id, organization_id, voice_reminder_sent_at, voice_reminder_call_sid')
      .eq('voice_reminder_status', 'sent')
      .lt('voice_reminder_sent_at', oneHourAgo)
      .limit(200)

    if (selErr) {
      console.error('[voice-reminder-staleness] select failed:', selErr.message)
      outcome.ok = false
      outcome.errors += 1
      return outcome
    }

    if (!stale || stale.length === 0) return outcome

    for (const row of stale) {
      const { data: updated, error: updErr } = await supabaseAdmin
        .from('consultations')
        .update({ voice_reminder_status: 'no_answer' })
        .eq('id', row.id)
        .eq('voice_reminder_status', 'sent')  // CAS — a late webhook still wins
        .select('id')
        .maybeSingle()
      if (updErr) {
        console.error(`[voice-reminder-staleness] flip failed for ${row.id}:`, updErr.message)
        outcome.errors += 1
        continue
      }
      if (!updated) continue  // a webhook arrived between SELECT and UPDATE; honored.

      outcome.flipped += 1

      // Activity log so the owner can see WHY a row resolved as
      // no_answer without the usual end-of-call-report data.
      await supabaseAdmin.from('activity_log').insert({
        organization_id: row.organization_id,
        action:          'voice_reminder_staled_to_no_answer',
        metadata: {
          consultation_id:        row.id,
          voice_reminder_sent_at: row.voice_reminder_sent_at,
          voice_reminder_call_sid: row.voice_reminder_call_sid,
        },
      })
    }

    return outcome
  })

  if (wrapped.skipped) return { ok: true, flipped: 0, errors: 0, skipped: true }
  return wrapped.result ?? outcome
}

export async function POST(request: Request) {
  const denied = requireCronAuth(request)
  if (denied) return denied

  const result = await sweepStaleReminders()
  return NextResponse.json({
    ok: result.ok,
    ran_at: new Date().toISOString(),
    staleness: result,
  })
}

export async function GET(request: Request) {
  return POST(request)
}
