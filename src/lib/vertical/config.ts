/**
 * Vertical config — single source of truth for how Layla and the CRM
 * adapt per business vertical, and how a tenant's caller languages are
 * resolved.
 *
 * Multi-vertical Phase 1. Everything here is additive: the 'medspa'
 * entry encodes today's behavior exactly, and getVerticalConfig()
 * falls back to it for any unknown/NULL value, so existing tenants are
 * never affected.
 *
 * Consumed by:
 *   - seed-assistants.ts  → prompt composition, transcriber + voice
 *     selection (via resolveCallerLanguages), extra tools, PHI gate.
 *   - post-call-summary-email route → phiScrub gate (Phase 1).
 *   - send-link-sms + notification helpers → terminology + language
 *     (Phase 2/3).
 */

export type Vertical = 'medspa' | 'trades' | 'food' | 'general'
export type OwnerLanguage = 'en' | 'es'
export type CallerLanguage = 'en' | 'es'
export type NotificationChannel = 'sms' | 'whatsapp' | 'both'

export const DEFAULT_VERTICAL: Vertical = 'medspa'

/** Customer-facing nouns for how a vertical talks about itself, EN +
 *  neutral Latin-American ES. Used in the voice prompt, customer
 *  confirmations, owner notifications, and dashboard/settings labels.
 *
 *  BYTE-IDENTICAL CONTRACT: every `medspa` value below reproduces the
 *  string med-spa surfaces show today, so a consumer that swaps a
 *  hardcoded noun for the matching term keeps med-spa output unchanged.
 *  The ONE exception is the scheduled-thing noun: med-spa says
 *  "consultation" on the booking/SMS/capture surfaces but "appointment"
 *  in /manage and the voice line — an inconsistent baseline. So
 *  `engagement`/`engagementPlural` carry med-spa's *voice* word
 *  ('appointment'); a surface whose med-spa literal is "consultation"
 *  must branch `vertical === 'medspa' ? 'consultation' : terms.engagement`
 *  rather than reach for the term, to stay byte-identical. */
export interface VerticalTerms {
  /** The thing Layla schedules (voice + owner alerts). */
  engagement: string
  engagementEs: string
  /** Plural of engagement (nav counts, digests). */
  engagementPlural: string
  engagementPluralEs: string
  /** Who performs the work. */
  provider: string
  providerEs: string
  /** The organization noun: 'clinic' | 'business'. */
  business: string
  businessEs: string
  /** The person who calls/books: 'patient' | 'customer'. */
  customer: string
  customerEs: string
  customerPlural: string
  customerPluralEs: string
  /** A concrete bookable-service example for settings placeholder copy. */
  serviceExample: string
}

export interface VerticalConfig {
  vertical: Vertical
  terms: VerticalTerms
  /**
   * Filename (without extension) under src/voice/prompts/verticals/
   * appended AFTER the base receptionist prompt to reframe terminology.
   * null = med-spa uses the base prompt alone (byte-identical to today).
   */
  promptFragment: string | null
  /** Fields Layla should try to capture when booking, beyond name+phone. */
  intakeQuestions: string[]
  /**
   * PHI scrubbing on the post-call summary. TRUE for medspa (covered
   * entity, unchanged). FALSE for the others — the sanitizer stays
   * available and can be flipped on per vertical if a tenant needs it.
   */
  phiScrub: boolean
  /**
   * Extra Vapi tools wired for this vertical, beyond the base inbound
   * set. Wired in seed-assistants; the tool routes ship in their own
   * phase (flag_urgent → Phase 4).
   */
  extraTools: string[]
}

const CONFIG: Record<Vertical, VerticalConfig> = {
  medspa: {
    vertical: 'medspa',
    terms: {
      engagement: 'appointment', engagementEs: 'cita',
      engagementPlural: 'appointments', engagementPluralEs: 'citas',
      provider: 'provider', providerEs: 'especialista',
      business: 'clinic', businessEs: 'clínica',
      customer: 'patient', customerEs: 'paciente',
      customerPlural: 'patients', customerPluralEs: 'pacientes',
      serviceExample: 'Botox consult — 30 min',
    },
    promptFragment: null,
    intakeQuestions: [],
    phiScrub: true,
    extraTools: [],
  },
  trades: {
    vertical: 'trades',
    terms: {
      engagement: 'job', engagementEs: 'trabajo',
      engagementPlural: 'jobs', engagementPluralEs: 'trabajos',
      provider: 'technician', providerEs: 'técnico',
      business: 'business', businessEs: 'negocio',
      customer: 'customer', customerEs: 'cliente',
      customerPlural: 'customers', customerPluralEs: 'clientes',
      serviceExample: 'AC repair — 60 min',
    },
    promptFragment: 'trades',
    intakeQuestions: [
      'the service address (where the work happens)',
      'a short description of the job',
      'a preferred day and time window',
      'any access notes — gate code, pets, where to park',
    ],
    phiScrub: false,
    extraTools: ['flag_urgent'],
  },
  food: {
    vertical: 'food',
    terms: {
      engagement: 'order', engagementEs: 'pedido',
      engagementPlural: 'orders', engagementPluralEs: 'pedidos',
      provider: 'kitchen', providerEs: 'cocina',
      business: 'business', businessEs: 'negocio',
      customer: 'customer', customerEs: 'cliente',
      customerPlural: 'customers', customerPluralEs: 'clientes',
      serviceExample: 'Large pepperoni pizza',
    },
    promptFragment: 'food',
    intakeQuestions: [
      'the items they want',
      'pickup or delivery',
      'the delivery address if delivery',
      'the time they want it',
    ],
    phiScrub: false,
    extraTools: [],
  },
  general: {
    vertical: 'general',
    terms: {
      engagement: 'appointment', engagementEs: 'cita',
      engagementPlural: 'appointments', engagementPluralEs: 'citas',
      provider: 'specialist', providerEs: 'especialista',
      business: 'business', businessEs: 'negocio',
      customer: 'customer', customerEs: 'cliente',
      customerPlural: 'customers', customerPluralEs: 'clientes',
      serviceExample: 'Consultation — 30 min',
    },
    promptFragment: 'general',
    intakeQuestions: [
      'the reason for the call',
      'a preferred day and time',
    ],
    phiScrub: false,
    extraTools: [],
  },
}

/** Resolve a tenant's vertical config, defaulting to med-spa for any
 *  unknown / NULL value so a mis-set column can never break a call. */
export function getVerticalConfig(vertical: string | null | undefined): VerticalConfig {
  return CONFIG[(vertical as Vertical)] ?? CONFIG[DEFAULT_VERTICAL]
}

/**
 * Caller languages the assistant must handle → drives the transcriber
 * model, the TTS voice, and the bilingual directive (Phase 2).
 *
 * Reads the org's `caller_languages` column DIRECTLY and independently
 * of owner_language: an English-speaking owner with a Spanish-speaking
 * customer base is a core segment (owner notifications in English, the
 * caller line bilingual EN+ES). owner_language governs only what the
 * OWNER reads.
 *
 * Defensive: coerces to the valid {en,es} set and guarantees a
 * non-empty result defaulting to ['en'], so a malformed column value
 * can never yield a voiceless/transcriber-less assistant. Existing
 * tenants default to ['en'] and are byte-identical to today.
 */
const VALID_CALLER_LANGS: readonly CallerLanguage[] = ['en', 'es']

export function resolveCallerLanguages(
  callerLanguages: readonly string[] | null | undefined,
): CallerLanguage[] {
  const valid = (callerLanguages ?? []).filter(
    (l): l is CallerLanguage => (VALID_CALLER_LANGS as readonly string[]).includes(l),
  )
  // De-dupe while preserving order; fall back to English-only.
  const seen = new Set<CallerLanguage>()
  for (const l of valid) seen.add(l)
  return seen.size > 0 ? [...seen] : ['en']
}

/** True when the tenant's assistant must be bilingual (EN+ES). */
export function isBilingual(
  callerLanguages: readonly string[] | null | undefined,
): boolean {
  return resolveCallerLanguages(callerLanguages).includes('es')
}
