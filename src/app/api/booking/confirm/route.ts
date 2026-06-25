import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { consume, ipFor, CONFIRM_LIMIT } from '@/lib/booking/public-rate-limit'

/**
 * POST /api/booking/confirm — Phase 4 W2.
 *
 * Promotes a status='hold' consultation to status='scheduled' atomically:
 *   UPDATE consultations
 *     SET status='scheduled', hold_token=null, held_until=null
 *     WHERE id=$1 AND hold_token=$2 AND status='hold' AND held_until > now()
 *     RETURNING id
 *
 * Zero rows returned = the hold expired, was already confirmed, was
 * canceled by the cron, or the token doesn't match → 410 Gone with a
 * patient-friendly message. The patient is invited back to pick again.
 *
 * No new row is created here — the row already exists from /hold.
 * This means the EXCLUDE constraint that protected the slot during
 * the hold continues to protect it after confirmation. No race here.
 */

const confirmSchema = z.object({
  consultation_id: z.string().uuid(),
  hold_token:      z.string().uuid(),
})

export async function POST(req: NextRequest) {
  const ip = ipFor(req)
  const rl = consume(ip, CONFIRM_LIMIT)
  if (!rl.ok) {
    return NextResponse.json(
      {
        error: 'rate_limited',
        message: `Too many requests. Try again in ${rl.retryAfterSeconds}s.`,
      },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    )
  }

  let rawBody: unknown
  try { rawBody = await req.json() } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  const parsed = confirmSchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input', message: parsed.error.issues[0].message }, { status: 400 })
  }
  const { consultation_id, hold_token } = parsed.data

  const nowIso = new Date().toISOString()
  const { data, error } = await supabaseAdmin
    .from('consultations')
    .update({
      status:      'scheduled',
      hold_token:  null,
      held_until:  null,
      updated_at:  nowIso,
    })
    .eq('id',         consultation_id)
    .eq('hold_token', hold_token)
    .eq('status',     'hold')
    .gt('held_until', nowIso)
    .select('id, scheduled_at, duration_min, organization_id, contact_id, provider_id, service_id')
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: 'confirm_failed', message: error.message }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json(
      {
        error: 'hold_expired_or_invalid',
        message: 'This hold has expired or the token is invalid. Please pick a slot again.',
      },
      { status: 410 },
    )
  }

  // Activity-log audit row so the clinic can see public bookings flow
  // in alongside manual ones. We don't fire reminders here — the
  // existing W3 reminder cron picks up scheduled rows on its next tick.
  await supabaseAdmin.from('activity_log').insert({
    organization_id: data.organization_id,
    contact_id:      data.contact_id,
    action:          'consultation_booked_public',
    metadata: {
      consultation_id: data.id,
      provider_id:     data.provider_id,
      service_id:      data.service_id,
      scheduled_at:    data.scheduled_at,
      booked_via:      'public_page',
    },
  })

  // Move the contact to "lead → booked" stage if the org has it.
  // Safe to fail silently — the row is already a real consultation.
  try {
    const { data: stage } = await supabaseAdmin
      .from('pipeline_stages')
      .select('id')
      .eq('organization_id', data.organization_id)
      .eq('label', 'Consultation Booked')
      .maybeSingle()
    if (stage) {
      await supabaseAdmin
        .from('contacts')
        .update({ stage_id: stage.id, last_contacted_at: nowIso })
        .eq('id', data.contact_id)
        .eq('organization_id', data.organization_id)
    }
  } catch {
    // Pipeline-stage move is best-effort; the consultation row is the
    // source of truth and is already saved.
  }

  return NextResponse.json({
    ok: true,
    consultation_id: data.id,
    scheduled_at:    data.scheduled_at,
    duration_min:    data.duration_min,
  })
}
