import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { mapBookingError } from '@/lib/booking/db-errors'
import { HOLD_TTL_MINUTES, HOLD_TTL_MS } from '@/lib/booking/types'
import { consume, ipFor, HOLD_LIMIT } from '@/lib/booking/public-rate-limit'

/**
 * POST /api/booking/hold — Phase 4 W2.
 *
 * Anonymous endpoint. Creates a contact (or reuses an existing one
 * by phone within the org) and inserts a consultations row with
 * status='hold' that occupies the requested slot for HOLD_TTL_MINUTES.
 * Returns a hold_token the patient sends back to /api/booking/confirm.
 *
 * Race prevention is the W1 EXCLUDE constraint
 * (consultations_no_provider_overlap). Two patients clicking the
 * same slot at the same instant both try to insert at status='hold'
 * — exactly one wins; the other gets 23P01 → mapped to HTTP 409
 * "Slot was just taken — please pick another time."
 *
 * Abandoned holds are NOT a waste: the contact row stays in the
 * clinic's CRM with source='public_booking' so the clinic can follow
 * up. The hold itself sweeps to status='canceled' on the next cron.
 */

const PHONE_RE = /^[\d\s().+\-]{7,32}$/
const NAME_RE  = /^[\p{L}\p{M}\s.'\-]{1,80}$/u

const holdSchema = z.object({
  orgSlug:      z.string().min(1).max(80),
  serviceId:    z.string().uuid(),
  providerId:   z.string().uuid(),
  slotStartUtc: z.string().min(1),
  name:         z.string().trim().regex(NAME_RE, 'Please enter a valid name').max(80),
  phone:        z.string().trim().regex(PHONE_RE, 'Please enter a valid phone').max(32),
  email:        z.string().trim().email().max(120).optional().or(z.literal('')),
  smsConsent:   z.literal(true, { message: 'SMS consent is required.' }),
  notes:        z.string().trim().max(500).optional().or(z.literal('')),
})

function normalizePhoneForDedup(raw: string): string {
  return raw.replace(/[^\d]/g, '')
}

export async function POST(req: NextRequest) {
  // ── Rate limit. Cheap and runs before any DB work. ──
  const ip = ipFor(req)
  const rl = consume(ip, HOLD_LIMIT)
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
  const parsed = holdSchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input', message: parsed.error.issues[0].message }, { status: 400 })
  }
  const input = parsed.data

  const slotStartDate = new Date(input.slotStartUtc)
  if (Number.isNaN(slotStartDate.getTime())) {
    return NextResponse.json({ error: 'invalid_slot' }, { status: 400 })
  }
  // Floor of "now + 1 minute" — slot must be in the future. The
  // engine's lead-time gate handles the upper end; this just refuses
  // already-past slots that a stale tab might submit.
  if (slotStartDate.getTime() < Date.now() - 60_000) {
    return NextResponse.json({ error: 'slot_in_past' }, { status: 400 })
  }

  // ── Resolve org + master toggle. ──
  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('id, name, booking_enabled')
    .eq('slug', input.orgSlug)
    .maybeSingle()
  if (!org)                 return NextResponse.json({ error: 'not_found' },          { status: 404 })
  if (!org.booking_enabled) return NextResponse.json({ error: 'booking_disabled' },   { status: 403 })
  const orgId = org.id as string

  // ── Verify the service + provider are bookable. ──
  const [serviceRes, providerRes, linkRes] = await Promise.all([
    supabaseAdmin
      .from('services')
      .select('id, duration_min, is_active, is_bookable_online')
      .eq('id', input.serviceId)
      .eq('organization_id', orgId)
      .maybeSingle(),
    supabaseAdmin
      .from('providers')
      .select('id, is_active')
      .eq('id', input.providerId)
      .eq('organization_id', orgId)
      .maybeSingle(),
    supabaseAdmin
      .from('service_providers')
      .select('service_id')
      .eq('organization_id', orgId)
      .eq('service_id', input.serviceId)
      .eq('provider_id', input.providerId)
      .maybeSingle(),
  ])
  if (!serviceRes.data || !serviceRes.data.is_active || !serviceRes.data.is_bookable_online) {
    return NextResponse.json({ error: 'service_not_bookable' }, { status: 404 })
  }
  if (!providerRes.data || !providerRes.data.is_active) {
    return NextResponse.json({ error: 'provider_not_available' }, { status: 404 })
  }
  if (!linkRes.data) {
    return NextResponse.json({ error: 'provider_cannot_perform_service' }, { status: 400 })
  }
  const durationMin = serviceRes.data.duration_min as number

  // ── Dedup contact by phone OR email within the org. ──
  // Abandoned holds leave a contact row behind on purpose (the clinic
  // gets a real lead either way). Reusing an existing contact prevents
  // duplicate rows for the same person across multiple booking attempts,
  // AND avoids tripping the contacts_org_email_unique index (which is
  // case-insensitive on email AND filtered on deleted_at IS NULL +
  // email IS NOT NULL). Phone takes priority — it's the channel we use
  // for SMS confirmation and reminders.
  const phoneKey   = normalizePhoneForDedup(input.phone)
  const emailKey   = (input.email ?? '').trim().toLowerCase()
  let contactId: string | null = null

  if (phoneKey.length >= 7) {
    const { data: existing } = await supabaseAdmin
      .from('contacts')
      .select('id')
      .eq('organization_id', orgId)
      .eq('phone', input.phone)
      .is('deleted_at', null)
      .maybeSingle()
    if (existing) contactId = existing.id as string
  }

  if (!contactId && emailKey.length > 0) {
    const { data: existingByEmail } = await supabaseAdmin
      .from('contacts')
      .select('id')
      .eq('organization_id', orgId)
      .ilike('email', emailKey)
      .is('deleted_at', null)
      .maybeSingle()
    if (existingByEmail) contactId = existingByEmail.id as string
  }

  if (!contactId) {
    const { data: newContact, error: contactErr } = await supabaseAdmin
      .from('contacts')
      .insert({
        organization_id: orgId,
        first_name:      input.name.split(' ')[0] ?? input.name,
        last_name:       input.name.split(' ').slice(1).join(' ') || null,
        phone:           input.phone,
        email:           input.email && input.email.length > 0 ? input.email : null,
        source:          'public_booking',
        status:          'lead',
        sms_consent:     true,
        sms_consent_at:  new Date().toISOString(),
      })
      .select('id')
      .single()
    if (contactErr || !newContact) {
      return NextResponse.json({ error: 'contact_create_failed', message: contactErr?.message ?? 'unknown' }, { status: 500 })
    }
    contactId = newContact.id as string
  } else {
    // Update consent + last contact info if reusing a contact.
    await supabaseAdmin
      .from('contacts')
      .update({
        sms_consent: true,
        sms_consent_at: new Date().toISOString(),
      })
      .eq('id', contactId)
      .eq('organization_id', orgId)
  }

  // ── Insert the hold. The EXCLUDE constraint is what makes this
  // race-safe — 23P01 maps to 409 via mapBookingError.
  const holdToken = randomUUID()
  const heldUntil = new Date(Date.now() + HOLD_TTL_MS).toISOString()

  const { data: held, error: insertErr } = await supabaseAdmin
    .from('consultations')
    .insert({
      organization_id:    orgId,
      contact_id:         contactId,
      type:               'in_person',
      scheduled_at:       slotStartDate.toISOString(),
      duration_min:       durationMin,
      status:             'hold',
      provider_id:        input.providerId,
      service_id:         input.serviceId,
      booked_via:         'public_page',
      hold_token:         holdToken,
      held_until:         heldUntil,
      // consultations table uses pre_consult_notes (context BEFORE the
      // visit) and post_consult_notes — there is no flat `notes` column.
      // The "anything we should know" field at booking time is
      // pre-consult context by definition.
      pre_consult_notes:  input.notes && input.notes.length > 0 ? input.notes : null,
    })
    .select('id')
    .single()

  if (insertErr) {
    const mapped = mapBookingError(insertErr)
    if (mapped) return mapped
    return NextResponse.json({ error: 'hold_failed', message: insertErr.message }, { status: 500 })
  }

  return NextResponse.json({
    consultation_id: held.id,
    hold_token:      holdToken,
    expires_at:      heldUntil,
    expires_in_seconds: Math.round(HOLD_TTL_MS / 1000),
  }, { status: 201 })
}
