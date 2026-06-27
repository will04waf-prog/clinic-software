/**
 * Phase 5 hardening — central call-envelope resolution.
 *
 * Background: every voice tool route needs to know two phone numbers:
 *
 *   - toE164   — the clinic's Twilio DID (resolves the org)
 *   - fromE164 — the caller's number   (resolves the patient identity)
 *
 * Both are supposed to come from the Vapi tool-call envelope (`tc.toE164`
 * and `tc.fromE164`). For dashboard testing we historically also
 * honored matching args (`to_e164`, `from_e164`, `phone_number`) — but
 * accepting those in PRODUCTION is a critical PHI / identity-bypass
 * vector: the LLM can be prompt-injected by a real caller into passing
 * a different number, and the route will then act on that number's
 * patient record (lookup_my_appointments leaks data; cancel/reschedule
 * mutate state).
 *
 * This helper is the single source of truth for envelope resolution:
 *
 *   - In NODE_ENV !== 'production', the args overrides are honored
 *     (matches the existing /tool/send-link-sms convention so the
 *     Vapi dashboard test harness keeps working).
 *
 *   - In NODE_ENV === 'production', args are IGNORED entirely. We
 *     read strictly from the envelope. Any non-empty arg is logged
 *     as an exploit attempt so we can audit prompt-injection probes
 *     after the fact.
 *
 * Routes call this once at the top of their handler instead of
 * inlining the precedence dance. Anyone who needs the override in
 * an integration test should set NODE_ENV=test or run locally.
 */

import { normalizePhone } from '@/lib/validators'
import type { NormalizedToolCall } from '@/lib/voice-agent/tool-types'

export interface ResolvedEnvelope {
  /** Clinic Twilio DID (E.164) or null. */
  toE164:   string | null
  /** Caller phone (E.164) or null. */
  fromE164: string | null
  /** True iff caller supplied an args override that the production
   *  build refused. Useful for diagnostic logs. */
  overrideAttempted: boolean
}

export function resolveCallEnvelope(tc: NormalizedToolCall): ResolvedEnvelope {
  const allowOverride = process.env.NODE_ENV !== 'production'

  const argsToE164Raw = typeof tc.arguments.to_e164 === 'string'
    ? tc.arguments.to_e164
    : undefined
  // `phone_number` was added for the "find by a different number"
  // flow; `from_e164` predates it. Both are caller-id overrides and
  // both must be gated identically.
  const argsFromRaw =
    (typeof tc.arguments.phone_number === 'string' ? tc.arguments.phone_number : undefined) ??
    (typeof tc.arguments.from_e164     === 'string' ? tc.arguments.from_e164     : undefined)

  const overrideAttempted = Boolean(argsToE164Raw || argsFromRaw)

  const argsToE164   = allowOverride ? argsToE164Raw : undefined
  const argsFromE164 = allowOverride ? argsFromRaw   : undefined

  const toE164   = normalizePhone(argsToE164   ?? tc.toE164   ?? '')
  const fromE164 = normalizePhone(argsFromE164 ?? tc.fromE164 ?? '')

  if (!allowOverride && overrideAttempted) {
    // Don't log full numbers — last 4 of whatever they tried to pass.
    console.warn('[voice/tool] envelope override attempted in prod (refused)', {
      callSid: tc.callSid,
      tool:    tc.name,
      to_arg_tail:   typeof argsToE164Raw === 'string' ? argsToE164Raw.slice(-4) : undefined,
      from_arg_tail: typeof argsFromRaw   === 'string' ? argsFromRaw.slice(-4)   : undefined,
    })
  }

  return { toE164, fromE164, overrideAttempted }
}
