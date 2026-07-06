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
import { supabaseAdmin } from '@/lib/supabase/admin'
import type { NormalizedToolCall } from '@/lib/voice-agent/tool-types'

/**
 * Web-demo masquerade. Browser calls (the landing page's "talk to her
 * right here" + the /demo/[slug] prospect previews) carry NO phone
 * numbers in the envelope — there is no Twilio leg at all — so
 * toE164-based org resolution would dead-end and every tool would
 * fail ("trouble reaching the schedule"). Those assistants are ours:
 * the capped web-demo clone and the demo_prospects clones. When the
 * envelope has no toE164 but names one of them, we resolve the call
 * AS IF it rang the demo clinic's line — tools then operate on the
 * fictional Tarhunna Aesthetics org (sample calendar, zero PHI).
 * Real clinic assistants always arrive with a Twilio DID and never
 * take this path.
 */
const DEMO_LINE_E164 = '+13019622856'
const WEB_DEMO_ASSISTANT_ID = '9410db69-f98f-4dbc-a85f-67dd5c2b821a'

async function isWebDemoAssistant(assistantId: string): Promise<boolean> {
  if (assistantId === WEB_DEMO_ASSISTANT_ID) return true
  const { data } = await supabaseAdmin
    .from('demo_prospects')
    .select('slug')
    .eq('vapi_assistant_id', assistantId)
    .maybeSingle()
  return Boolean(data)
}

export interface ResolvedEnvelope {
  /** Clinic Twilio DID (E.164) or null. */
  toE164:   string | null
  /** Caller phone (E.164) or null. */
  fromE164: string | null
  /** True iff caller supplied an args override that the production
   *  build refused. Useful for diagnostic logs. */
  overrideAttempted: boolean
}

export async function resolveCallEnvelope(tc: NormalizedToolCall): Promise<ResolvedEnvelope> {
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

  let toE164     = normalizePhone(argsToE164   ?? tc.toE164   ?? '')
  const fromE164 = normalizePhone(argsFromE164 ?? tc.fromE164 ?? '')

  // Web calls: no phone envelope at all → masquerade OUR demo
  // assistants as calls to the demo clinic's line (see above).
  if (!toE164 && tc.assistantId && (await isWebDemoAssistant(tc.assistantId))) {
    toE164 = DEMO_LINE_E164
  }

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
