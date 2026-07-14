/**
 * POST /api/booking/reschedule — Phase 4 W5.
 *
 * Token-authenticated. The patient submits a /manage/[token] token
 * (HMAC-signed consultation_id) + a new scheduled_at. Backend does a
 * single atomic UPDATE that moves the row's scheduled_at; the
 * BEFORE-update trigger recomputes end_at and time_range, and the
 * EXCLUDE constraint on (provider_id, time_range) catches conflicts.
 *
 * Why single-UPDATE (not hold-then-confirm like the original /book
 * flow): the row already exists in 'scheduled' state and already
 * owns its slot. A reschedule is conceptually "move this row a bit
 * in time" — there's no second row to coordinate, and the EXCLUDE
 * constraint protects against landing on top of another patient.
 *
 * Guards (defense in depth — the front-end picks from validated
 * availability, but never trust the client):
 *   1. Token verifies.
 *   2. Row exists, has status in ('scheduled', 'confirmed'), not
 *      already in the past.
 *   3. new scheduled_at is in the future.
 *   4. new scheduled_at != current scheduled_at (no-op rejected so
 *      we don't fire spurious owner-emails).
 *   5. EXCLUDE constraint catches slot collisions → 409.
 *
 * After a successful UPDATE: fire reschedule confirmation SMS (same
 * confirmation template, new time) and owner email via after().
 */

import { NextRequest, NextResponse, after } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { consume, ipFor, RESCHEDULE_LIMIT } from '@/lib/booking/public-rate-limit'
import { verifyManageToken, signManageToken } from '@/lib/booking/manage-token'
import { sendConsultationSms } from '@/lib/consultation-reminders'
import { notifyOwnerOfBooking } from '@/lib/booking/owner-notification'
import { mapBookingError } from '@/lib/booking/db-errors'
import { assertSlotBookable } from '@/lib/booking/assert-slot-bookable'

const rescheduleSchema = z.object({
  manage_token: z.string().min(8),
  // ISO-8601 instant, ≥ 60 chars wouldn't happen; min 10 catches
  // garbage. Postgres will reject any non-parseable string with 22008
  // and mapBookingError will fall through to a generic 500.
  scheduled_at: z.string().min(10).max(64),
  // Optional — when the picker offers slots from multiple providers
  // (service has more than one provider linked), the client passes
  // the providerId of the chosen slot so the booking can move onto
  // that provider's calendar. Omitting it keeps the existing
  // provider_id (the original assignment).
  provider_id: z.string().uuid().optional(),
})

export async function POST(req: NextRequest) {
  const ip = ipFor(req)
  const rl = consume(ip, RESCHEDULE_LIMIT)
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
  const parsed = rescheduleSchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input', message: parsed.error.issues[0].message }, { status: 400 })
  }

  const consultationId = verifyManageToken(parsed.data.manage_token)
  if (!consultationId) {
    return NextResponse.json({ error: 'invalid_token' }, { status: 401 })
  }

  // Parse + validate the target instant.
  const newScheduledAt = new Date(parsed.data.scheduled_at)
  if (isNaN(newScheduledAt.getTime())) {
    return NextResponse.json({ error: 'invalid_input', message: 'scheduled_at is not a valid timestamp' }, { status: 400 })
  }
  const now = new Date()
  if (newScheduledAt.getTime() <= now.getTime()) {
    return NextResponse.json({ error: 'invalid_input', message: 'scheduled_at must be in the future' }, { status: 400 })
  }

  // Resolve the row and verify it's in a state that can be moved.
  // SELECT before UPDATE so we can return distinct errors (already
  // canceled vs in the past vs token-points-to-nothing) — the
  // patient's UI shows different messaging for each.
  // Fetch the row + the service's lead_time + booking_horizon so we
  // can enforce the same constraints the public booking flow does.
  // Without these guards a token-holder could POST a scheduled_at
  // outside business hours or 6 months out and the EXCLUDE constraint
  // would happily accept it.
  const { data: row, error: rowErr } = await supabaseAdmin
    .from('consultations')
    .select(`
      id, organization_id, contact_id, provider_id, scheduled_at,
      duration_min, status, booked_via, service_id,
      service:services(lead_time_hours, booking_horizon_days)
    `)
    .eq('id', consultationId)
    .maybeSingle()
  if (rowErr) {
    return NextResponse.json({ error: 'lookup_failed' }, { status: 500 })
  }
  if (!row) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  if (row.status === 'canceled') {
    return NextResponse.json({ error: 'already_canceled', message: 'This booking was canceled.' }, { status: 409 })
  }
  if (!['scheduled', 'confirmed'].includes(row.status)) {
    return NextResponse.json({ error: 'invalid_status', message: 'This booking cannot be rescheduled in its current state.' }, { status: 409 })
  }
  if (new Date(row.scheduled_at).getTime() <= now.getTime()) {
    return NextResponse.json({ error: 'already_past', message: 'This booking is already past.' }, { status: 409 })
  }
  if (Math.abs(new Date(row.scheduled_at).getTime() - newScheduledAt.getTime()) < 60_000) {
    return NextResponse.json({ error: 'no_change', message: 'You picked the same time you already have.' }, { status: 400 })
  }

  // ── Lead-time + horizon guards (defense in depth) ──
  // The picker calls /api/booking/public/[slug]/availability which
  // already enforces these. The backend repeats them so a manually
  // crafted POST can't book outside policy.
  const svc = Array.isArray(row.service) ? row.service[0] : row.service
  const leadHours = svc?.lead_time_hours ?? 0
  const horizonDays = svc?.booking_horizon_days ?? 60
  const earliestAllowed = now.getTime() + leadHours * 3600_000
  const latestAllowed   = now.getTime() + horizonDays * 86_400_000
  if (newScheduledAt.getTime() < earliestAllowed) {
    return NextResponse.json({ error: 'too_soon', message: 'That time is too close to now — please pick a later slot.' }, { status: 400 })
  }
  if (newScheduledAt.getTime() > latestAllowed) {
    return NextResponse.json({ error: 'too_far', message: 'That time is past how far ahead the clinic books — please pick a sooner slot.' }, { status: 400 })
  }

  // ── Provider routing ──
  // If the client supplied a provider_id (multi-provider service),
  // verify it's actually linked to the booked service. The EXCLUDE
  // constraint catches double-booking but says nothing about whether
  // a provider can perform a given service.
  let newProviderId = row.provider_id
  if (parsed.data.provider_id && parsed.data.provider_id !== row.provider_id) {
    const { data: link } = await supabaseAdmin
      .from('service_providers')
      .select('provider_id')
      .eq('organization_id', row.organization_id)
      .eq('service_id', row.service_id!)
      .eq('provider_id', parsed.data.provider_id)
      .maybeSingle()
    if (!link) {
      return NextResponse.json({ error: 'invalid_provider', message: 'That provider cannot take this appointment.' }, { status: 400 })
    }
    newProviderId = parsed.data.provider_id
  }

  // ── Availability re-check (audit M2 + M3) ──
  // Lead-time + horizon above bound HOW FAR from now, but say nothing
  // about time-of-day, open days, or the provider's buffer. Ask the same
  // engine the picker uses whether this exact instant is actually
  // offerable, so a hand-crafted token POST can't land at 3 AM, on a
  // closed day, or back-to-back inside the configured buffer.
  if (newProviderId) {
    const bookable = await assertSlotBookable(supabaseAdmin, {
      organizationId: row.organization_id,
      providerId: newProviderId,
      serviceId: row.service_id!,
      startUtc: newScheduledAt,
      now,
      excludeConsultationId: consultationId,
    })
    if (!bookable.ok) {
      return NextResponse.json(
        { error: 'slot_unavailable', message: 'That time is not open for booking — please pick an available slot.' },
        { status: 409 },
      )
    }
  }

  // Atomic move. The trigger recomputes end_at + time_range; the
  // EXCLUDE constraint catches any provider-conflict. The optimistic
  // lock on scheduled_at means a second concurrent reschedule (rapid
  // double-tap, double-clicked client retry) hits 0 rows on the
  // second attempt — we return 409 below, so the patient sees one
  // SMS for the winning move and a clean error for the loser.
  const nowIso = now.toISOString()
  const newScheduledIso = newScheduledAt.toISOString()
  // If the new slot is already inside the 24h reminder window, the
  // confirmation SMS we're about to fire IS the reminder — leave the
  // flag set so the cron doesn't double-text the patient. Same for 2h.
  const minutesUntilNew = (newScheduledAt.getTime() - now.getTime()) / 60_000
  const reminder24Preset = minutesUntilNew <= 26 * 60
  const reminder2Preset  = minutesUntilNew <=  3 * 60
  const { data: updated, error: updateErr } = await supabaseAdmin
    .from('consultations')
    .update({
      scheduled_at:      newScheduledIso,
      provider_id:       newProviderId,
      reminder_24h_sent: reminder24Preset,
      reminder_2h_sent:  reminder2Preset,
      updated_at:        nowIso,
    })
    .eq('id', consultationId)
    .eq('scheduled_at', row.scheduled_at) // optimistic lock
    .in('status', ['scheduled', 'confirmed'])
    .select('id, organization_id, contact_id, scheduled_at')
    .maybeSingle()
  if (updateErr) {
    const mapped = mapBookingError(updateErr)
    if (mapped) return mapped
    return NextResponse.json({ error: 'reschedule_failed', message: updateErr.message }, { status: 500 })
  }
  if (!updated) {
    // Disambiguate: the UPDATE didn't match. Re-read the row to find
    // out why. Possibilities: (a) row was canceled by owner mid-flight
    // → 409 already_canceled, (b) row was rescheduled by a racing
    // request → 409 stale_state, (c) row vanished (extremely unlikely
    // — we'd have hit !row above) → 404.
    const { data: post } = await supabaseAdmin
      .from('consultations')
      .select('status, scheduled_at')
      .eq('id', consultationId)
      .maybeSingle()
    if (!post) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }
    if (post.status === 'canceled') {
      return NextResponse.json({ error: 'already_canceled', message: 'This booking was just canceled.' }, { status: 409 })
    }
    return NextResponse.json({ error: 'stale_state', message: 'This booking changed in the meantime — please refresh and try again.' }, { status: 409 })
  }

  // Audit row. Forensics fields (ip, ua, token fingerprint) help the
  // owner audit "who canceled this booking" given the only actor
  // identity is "someone with the token."
  const tokenFingerprint = parsed.data.manage_token.slice(-12)
  const userAgent = req.headers.get('user-agent')?.slice(0, 200) ?? null
  await supabaseAdmin.from('activity_log').insert({
    organization_id: updated.organization_id,
    contact_id:      updated.contact_id,
    action:          'consultation_rescheduled_public',
    metadata: {
      consultation_id:    updated.id,
      old_scheduled_at:   row.scheduled_at,
      new_scheduled_at:   updated.scheduled_at,
      ip,
      user_agent:         userAgent,
      token_fingerprint:  tokenFingerprint,
    },
  })

  // Sign a fresh URL — the token doesn't change (it encodes only the
  // consultation_id) but the URL needs to be embedded in the SMS we
  // send below.
  let manageUrl: string | null = null
  try {
    const token = signManageToken(updated.id)
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://tarhunna.net').replace(/\/$/, '')
    manageUrl = `${appUrl}/manage/${token}`
  } catch (err) {
    console.error('[reschedule manage token] failed to sign:', err instanceof Error ? err.message : 'unknown')
  }

  after(async () => {
    try {
      // Re-check status — if the owner canceled the row between the
      // UPDATE above and this after() running, skip the confirmation
      // SMS (the patient would otherwise be told their reschedule
      // confirmed when in fact it's been canceled).
      const { data: postUpdate } = await supabaseAdmin
        .from('consultations')
        .select('status')
        .eq('id', updated.id)
        .maybeSingle()
      if (!postUpdate || !['scheduled', 'confirmed'].includes(postUpdate.status)) return

      const [{ data: orgSms }, { data: contactSms }] = await Promise.all([
        supabaseAdmin
          .from('organizations')
          .select(`
            name, timezone, vertical,
            sms_enabled, sms_confirmation_enabled,
            sms_template_confirmation, sms_template_confirmation_es
          `)
          .eq('id', updated.organization_id)
          .single(),
        supabaseAdmin
          .from('contacts_active')
          .select('id, first_name, phone, opted_out_sms, sms_consent, preferred_language')
          .eq('id', updated.contact_id)
          .single(),
      ])
      if (!orgSms || !contactSms) {
        console.error('[reschedule confirmation sms] precondition fetch returned null')
        return
      }
      await sendConsultationSms({
        type: 'confirmation',
        org: orgSms as any,
        contact: contactSms as any,
        consultation: {
          id: updated.id,
          organization_id: updated.organization_id,
          scheduled_at: updated.scheduled_at,
        },
        manageUrl,
      })
    } catch {
      console.error('[reschedule confirmation sms] failed')
    }
  })

  after(async () => {
    try {
      await notifyOwnerOfBooking({
        organizationId: updated.organization_id,
        consultationId: updated.id,
        scheduledAtIso: updated.scheduled_at,
        kind: 'rescheduled',
      })
    } catch {
      console.error('[reschedule owner notification] failed')
    }
  })

  return NextResponse.json({
    ok: true,
    consultation_id: updated.id,
    scheduled_at:    updated.scheduled_at,
  })
}
