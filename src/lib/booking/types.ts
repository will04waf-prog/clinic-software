/**
 * Phase 4 W1 — booking domain types.
 *
 * These mirror the DB shape introduced by
 * supabase/migrations/20260701120000_add_booking_foundation.sql.
 * They live here (not in src/types/index.ts) per the W1 scope
 * boundary: src/types/index.ts is owned by Agent B and is the
 * place where TriggerType union and Consultation extensions
 * land.
 *
 * The engine in availability.ts consumes the *Input subtypes
 * (Provider/Service/Rule/Override with only the fields the
 * math needs). The full row types document the persistence
 * shape for API routes.
 *
 * Everything here is plain data — no functions, no Supabase
 * imports, no Date constructors at module scope.
 */

// ────────────────────────────────────────────────────────────
// Tunables
// ────────────────────────────────────────────────────────────

/**
 * Hold TTL — how long a tentative booking stays "held" before the
 * cron sweep cancels it. Single source of truth so the W2 hold
 * endpoint, the cron sweep, and the W2 UI all agree.
 *
 * 10 minutes is the smallest interval that gives a patient enough
 * time to enter name/email/phone + confirm without making a stale
 * tab perpetually block real bookings.
 */
export const HOLD_TTL_MINUTES = 10
export const HOLD_TTL_MS = HOLD_TTL_MINUTES * 60_000

// ────────────────────────────────────────────────────────────
// Full row shapes (persistence-side).
// ────────────────────────────────────────────────────────────

export interface Provider {
  id:                string
  organization_id:   string
  profile_id:        string | null
  display_name:      string
  role_label:        string | null
  photo_url:         string | null
  is_active:         boolean
  buffer_before_min: number
  buffer_after_min:  number
  created_at:        string
  updated_at:        string
}

export interface Service {
  id:                   string
  organization_id:      string
  name:                 string
  description:          string | null
  duration_min:         number
  price_cents:          number | null
  lead_time_hours:      number
  booking_horizon_days: number
  is_active:            boolean
  is_bookable_online:   boolean
  color:                string | null
  position:             number
  created_at:           string
  updated_at:           string
}

export interface ServiceProvider {
  service_id:      string
  provider_id:     string
  organization_id: string
  created_at:      string
}

export interface AvailabilityRule {
  id:              string
  organization_id: string
  provider_id:     string
  /** 0=Sunday … 6=Saturday, matches JS Date.getDay(). */
  weekday:         number
  /** HH:MM clinic-local. */
  start_time:      string
  /** HH:MM clinic-local. */
  end_time:        string
  created_at:      string
}

export type AvailabilityOverrideKind = 'closed' | 'custom'

export interface AvailabilityOverride {
  id:              string
  organization_id: string
  /** Null = clinic-wide. */
  provider_id:     string | null
  kind:            AvailabilityOverrideKind
  /** YYYY-MM-DD clinic-local. */
  date:            string
  /** Required when kind='custom'. */
  start_time:      string | null
  /** Required when kind='custom'. */
  end_time:        string | null
  reason:          string | null
  created_at:      string
}

/**
 * Phase 4 W1 — hold metadata projected from consultations.
 *
 * A hold IS a consultations row with status='hold' and a
 * held_until in the future. We do not have a separate
 * bookings table; this interface only documents the subset of
 * columns the booking flow cares about.
 */
export interface BookingHold {
  id:           string
  hold_token:   string | null
  held_until:   string | null
  status:       string
  provider_id:  string | null
  service_id:   string | null
  scheduled_at: string
  end_at:       string | null
}

// ────────────────────────────────────────────────────────────
// Engine-facing subtypes — only the fields the math needs.
// ────────────────────────────────────────────────────────────

export interface ProviderForEngine {
  id:                string
  bufferBeforeMin:   number
  bufferAfterMin:    number
}

export interface ServiceForEngine {
  id:                  string
  durationMin:         number
  leadTimeHours:       number
  bookingHorizonDays:  number
}

export interface RuleForEngine {
  providerId: string
  /** 0=Sunday … 6=Saturday. */
  weekday:    number
  /** HH:MM clinic-local. */
  startTime:  string
  /** HH:MM clinic-local. */
  endTime:    string
}

export interface OverrideForEngine {
  /** Null = clinic-wide. */
  providerId: string | null
  kind:       AvailabilityOverrideKind
  /** YYYY-MM-DD clinic-local. */
  date:       string
  startTime:  string | null
  endTime:    string | null
}

/**
 * Slots already held / scheduled / confirmed for a provider.
 * Holds count — patient A's 10-minute reservation must be
 * invisible to patient B's search.
 */
export interface ExistingBooking {
  providerId: string
  startUtc:   Date
  endUtc:     Date
}

export interface AvailabilityInput {
  /** Inclusive lower bound on slot starts (UTC). */
  fromUtc:    Date
  /** Exclusive upper bound on slot ends (UTC). */
  toUtc:      Date
  /** Clinic IANA zone (organizations.timezone). */
  timezone:   string
  service:    ServiceForEngine
  providers:  ProviderForEngine[]
  rules:      RuleForEngine[]
  overrides:  OverrideForEngine[]
  existingBookings: ExistingBooking[]
  /**
   * Grid step in minutes. Slot starts align to multiples of
   * this offset from the open interval start. Default 15.
   */
  slotStepMin?: number
  /** Injectable for tests. */
  now: Date
}

export interface SlotResult {
  /** ISO UTC of the slot start. */
  startUtc:   string
  /** ISO UTC of the slot end (start + service.durationMin). */
  endUtc:     string
  /** Every provider open at this instant. W2 picks one. */
  providerIds: string[]
}
