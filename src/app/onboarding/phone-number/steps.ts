/**
 * Phase 5 M3 — shared step taxonomy + types for the phone-number
 * onboarding flow.
 *
 * These live OUTSIDE actions.ts because that file carries the
 * 'use server' directive, and a server-actions module may only export
 * async functions. Exporting the PROVISIONING_STEPS const (a runtime
 * array) from there throws at request time:
 *   "A 'use server' file can only export async functions, found object."
 * Keeping the const + the plain types here lets both the server actions
 * and the client components import them without tripping that rule.
 */

// ── Step taxonomy ─────────────────────────────────────────────────
//
// Canonical step names match the strings the M1 migration comments
// blessed and that M5's runner dispatches on. These are also the
// strings stored in provisioning_jobs.step.
//
// Ordering matters: the UI's stepper renders rows in this order and
// the runner advances strictly in this order (vapi register requires
// the twilio buy step to have written twilio_phone_sid back to the
// org; a2p brand needs no upstream but is grouped after vapi so the
// PSTN side is online first; campaign requires a brand SID).
export const PROVISIONING_STEPS = [
  'buy_twilio_number',
  'register_vapi_phone',
  'register_a2p_brand',
  'register_a2p_campaign',
] as const

export type ProvisioningStep = (typeof PROVISIONING_STEPS)[number]
export type ProvisioningJobStatus = 'pending' | 'in_progress' | 'succeeded' | 'failed'

export interface NumberSearchResult {
  e164:          string
  friendly_name: string
  region?:       string
  locality?:     string
  // Twilio's capabilities map varies — keep loose to avoid TS friction
  // when the upstream adds new capability flags.
  capabilities?: Record<string, boolean>
}

export interface ProvisioningStepRow {
  step:       ProvisioningStep
  status:     ProvisioningJobStatus | 'not_started'
  last_error: string | null
  updated_at: string | null
}
