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

/** Customer-facing noun for the thing Layla schedules, EN + neutral
 *  Latin-American ES. Used in the prompt and in customer confirmations. */
export interface VerticalTerms {
  engagement: string
  engagementEs: string
  provider: string
  providerEs: string
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
    terms: { engagement: 'appointment', engagementEs: 'cita', provider: 'provider', providerEs: 'especialista' },
    promptFragment: null,
    intakeQuestions: [],
    phiScrub: true,
    extraTools: [],
  },
  trades: {
    vertical: 'trades',
    terms: { engagement: 'job', engagementEs: 'trabajo', provider: 'technician', providerEs: 'técnico' },
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
    terms: { engagement: 'order', engagementEs: 'pedido', provider: 'kitchen', providerEs: 'cocina' },
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
    terms: { engagement: 'appointment', engagementEs: 'cita', provider: 'specialist', providerEs: 'especialista' },
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
