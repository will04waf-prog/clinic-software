/**
 * Internal hold-creation logic — Phase 5 hardening.
 *
 * Background: the original /api/booking/hold route did both the
 * HTTP wrangling (rate-limit, JSON parse, error→status mapping) and
 * the actual booking work (org+service+provider validation, contact
 * dedupe, race-safe consultation insert) in one function. The voice
 * receptionist tool /api/voice/tool/hold then called that route over
 * the network just to reuse the booking work.
 *
 * That layered-HTTP shape created a real bug: every Vapi-originated
 * hold inherits the SAME source IP (Vapi's egress), so every voice
 * caller in the fleet was sharing ONE per-IP rate-limit bucket on the
 * public endpoint. A few simultaneous voice bookings would 429 each
 * other.
 *
 * Fix: lift the actual booking work into this in-process helper.
 *   - /api/booking/hold remains an HTTP boundary — parses JSON, runs
 *     ipFor + consume(), then calls holdBookingInternal().
 *   - /api/voice/tool/hold calls holdBookingInternal() directly,
 *     skipping the per-IP rate limit. Voice traffic is already gated
 *     upstream (Vapi assistant minutes + the caller is on the line —
 *     they can't dial-and-redial fast enough to abuse this).
 *
 * Result shape is structured, NOT HTTP — both callers turn the
 * `reason` enum into their own response envelope (HTTP status vs
 * Vapi tool-call result).
 */

import { randomUUID } from 'crypto'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { HOLD_TTL_MS } from '@/lib/booking/types'
import { assertSlotBookable } from '@/lib/booking/assert-slot-bookable'

const PHONE_RE = /^[\d\s().+\-]{7,32}$/
const NAME_RE  = /^[\p{L}\p{M}\s.'\-]{1,80}$/u

/**
 * Public input — what both callers pass. orgSlug XOR orgId. The
 * public route resolves by slug (because that's what the URL gave it);
 * the voice route resolves by id (because it already looked up the
 * org via twilio_phone_number → id and there's no point repeating the
 * lookup in here).
 */
export const holdInputSchema = z.object({
  orgSlug:      z.string().min(1).max(80).optional(),
  orgId:        z.string().uuid().optional(),
  serviceId:    z.string().uuid(),
  providerId:   z.string().uuid(),
  slotStartUtc: z.string().min(1),
  name:         z.string().trim().regex(NAME_RE, 'Please enter a valid name').max(80),
  phone:        z.string().trim().regex(PHONE_RE, 'Please enter a valid phone').max(32),
  email:        z.string().trim().email().max(120).optional().or(z.literal('')),
  smsConsent:   z.literal(true, { message: 'SMS consent is required.' }),
  notes:        z.string().trim().max(500).optional().or(z.literal('')),
})
export type HoldInput = z.infer<typeof holdInputSchema>

/**
 * Closed enum of failure modes. Both callers map this to their own
 * response shape:
 *
 *   - 'invalid_args'                 → 400 / structured tool error
 *   - 'invalid_slot' / 'slot_in_past'→ 400 / structured tool error
 *   - 'not_found'                    → 404 / "clinic not found"
 *   - 'booking_disabled'             → 403
 *   - 'service_not_bookable'         → 404
 *   - 'provider_not_available'       → 404
 *   - 'provider_cannot_perform_service' → 400
 *   - 'slot_taken'                   → 409 / structured tool {booked:false, reason:'slot_taken'}
 *   - 'contact_create_failed'        → 500
 *   - 'hold_failed'                  → 500
 *
 * `message` is an optional, NON-PHI human-readable detail useful for
 * logs. Never echo raw DB error messages to the caller from voice
 * routes; the structured `reason` is what the LLM should branch on.
 */
export type HoldReason =
  | 'invalid_args'
  | 'invalid_slot'
  | 'slot_in_past'
  | 'not_found'
  | 'booking_disabled'
  | 'service_not_bookable'
  | 'provider_not_available'
  | 'provider_cannot_perform_service'
  | 'slot_taken'
  | 'contact_create_failed'
  | 'hold_failed'

export type HoldResult =
  | {
      ok: true
      consultation_id:    string
      hold_token:         string
      /** ISO timestamp the hold expires at (renamed `expires_at` for
       *  public HTTP, `held_until` for the voice tool — both pass
       *  through this same value). */
      expires_at:         string
      expires_in_seconds: number
    }
  | { ok: false; reason: HoldReason; message?: string }

function isSlotConflictError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { code?: string; constraint?: string }
  return e.code === '23P01' || e.constraint === 'consultations_no_provider_overlap'
}

function normalizePhoneForDedup(raw: string): string {
  return raw.replace(/[^\d]/g, '')
}

export async function holdBookingInternal(rawInput: unknown): Promise<HoldResult> {
  const parsed = holdInputSchema.safeParse(rawInput)
  if (!parsed.success) {
    return { ok: false, reason: 'invalid_args', message: parsed.error.issues[0].message }
  }
  const input = parsed.data

  // Exactly one of orgId / orgSlug must be set. Public route always
  // uses slug; voice route always uses id. Caller mistake = 400.
  if (!input.orgId && !input.orgSlug) {
    return { ok: false, reason: 'invalid_args', message: 'orgId or orgSlug required' }
  }

  const slotStartDate = new Date(input.slotStartUtc)
  if (Number.isNaN(slotStartDate.getTime())) {
    return { ok: false, reason: 'invalid_slot' }
  }
  // Floor of "now - 1 minute" — slot must be in the future. Tolerates
  // a tiny skew between client and server clocks but rejects already-
  // past slots that a stale tab might submit.
  if (slotStartDate.getTime() < Date.now() - 60_000) {
    return { ok: false, reason: 'slot_in_past' }
  }

  // ── Resolve org + master toggle. ──
  let orgQuery = supabaseAdmin
    .from('organizations')
    .select('id, name, booking_enabled')
  if (input.orgId)        orgQuery = orgQuery.eq('id',   input.orgId)
  else if (input.orgSlug) orgQuery = orgQuery.eq('slug', input.orgSlug)

  const { data: org } = await orgQuery.maybeSingle()
  if (!org)                 return { ok: false, reason: 'not_found' }
  if (!org.booking_enabled) return { ok: false, reason: 'booking_disabled' }
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
    return { ok: false, reason: 'service_not_bookable' }
  }
  if (!providerRes.data || !providerRes.data.is_active) {
    return { ok: false, reason: 'provider_not_available' }
  }
  if (!linkRes.data) {
    return { ok: false, reason: 'provider_cannot_perform_service' }
  }
  const durationMin = serviceRes.data.duration_min as number

  // ── Availability re-check (audit M3) ──
  // The EXCLUDE constraint blocks raw overlap but not the provider's
  // buffer or availability rules, so a hand-crafted hold with a slot the
  // picker never offered could land off-hours or exactly adjacent to
  // another visit. Re-run the same engine the picker uses. (The public
  // flow already showed a valid slot; this closes hand-crafted requests
  // and a slot taken between offer and hold.)
  const bookable = await assertSlotBookable(supabaseAdmin, {
    organizationId: orgId,
    providerId: input.providerId,
    serviceId: input.serviceId,
    startUtc: slotStartDate,
  })
  if (!bookable.ok) {
    return { ok: false, reason: bookable.reason === 'lookup_failed' ? 'invalid_slot' : 'slot_taken' }
  }

  // ── Dedup contact by phone OR email within the org. ──
  // Abandoned holds leave a contact row behind on purpose (the clinic
  // gets a real lead either way). Reusing an existing contact prevents
  // duplicate rows for the same person across multiple booking attempts,
  // AND avoids tripping the contacts_org_email_unique index (which is
  // case-insensitive on email AND filtered on deleted_at IS NULL +
  // email IS NOT NULL). Phone takes priority — it's the channel we use
  // for SMS confirmation and reminders.
  const phoneKey = normalizePhoneForDedup(input.phone)
  const emailKey = (input.email ?? '').trim().toLowerCase()
  let contactId: string | null = null

  // Track the existing contact's opt-out so we don't blindly reset
  // sms_consent for someone who previously sent STOP. A patient who
  // STOP'd would otherwise re-opt-in just by submitting a booking
  // form, which violates TCPA.
  let existingOptedOut = false
  if (phoneKey.length >= 7) {
    const { data: existing } = await supabaseAdmin
      .from('contacts')
      .select('id, opted_out_sms')
      .eq('organization_id', orgId)
      .eq('phone', input.phone)
      .is('deleted_at', null)
      .maybeSingle()
    if (existing) {
      contactId       = existing.id as string
      existingOptedOut = existing.opted_out_sms === true
    }
  }

  if (!contactId && emailKey.length > 0) {
    const { data: existingByEmail } = await supabaseAdmin
      .from('contacts')
      .select('id, opted_out_sms')
      .eq('organization_id', orgId)
      .ilike('email', emailKey)
      .is('deleted_at', null)
      .maybeSingle()
    if (existingByEmail) {
      contactId       = existingByEmail.id as string
      existingOptedOut = existingByEmail.opted_out_sms === true
    }
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
      return { ok: false, reason: 'contact_create_failed', message: contactErr?.message ?? 'unknown' }
    }
    contactId = newContact.id as string
  } else {
    // Reusing an existing contact. Refresh phone with what the patient
    // typed (the stored value may be stale). DO NOT touch sms_consent
    // if the contact previously sent STOP — re-opting them in via the
    // booking form is a TCPA violation. The owner can re-collect
    // consent explicitly if needed.
    const patch: Record<string, unknown> = { phone: input.phone }
    if (!existingOptedOut) {
      patch.sms_consent    = true
      patch.sms_consent_at = new Date().toISOString()
    }
    await supabaseAdmin
      .from('contacts')
      .update(patch)
      .eq('id', contactId)
      .eq('organization_id', orgId)
  }

  // ── Insert the hold. The EXCLUDE constraint
  // (consultations_no_provider_overlap) is what makes this race-safe
  // — two simultaneous holds for the same (provider, time) slot both
  // try to INSERT; exactly one wins, the loser gets 23P01 which we
  // surface as the structured `slot_taken` reason. ──
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
    if (isSlotConflictError(insertErr)) {
      return { ok: false, reason: 'slot_taken' }
    }
    return { ok: false, reason: 'hold_failed', message: insertErr.message }
  }

  return {
    ok: true,
    consultation_id:    held.id as string,
    hold_token:         holdToken,
    expires_at:         heldUntil,
    expires_in_seconds: Math.round(HOLD_TTL_MS / 1000),
  }
}
