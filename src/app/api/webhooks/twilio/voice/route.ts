/**
 * POST /api/webhooks/twilio/voice — Phase 5 W1.
 *
 * Twilio hits this for every inbound voice call to a number we
 * own. We:
 *   1. Verify x-twilio-signature.
 *   2. Resolve org by `To` (organizations.twilio_phone_number).
 *   3. Check call_agent_enabled + baa_attested_at + mode.
 *      - off                                  → forward to fallback (or hang up if none).
 *      - after_hours during business hours    → forward to fallback (clinic answers live).
 *      - after_hours outside business hours   → hand to Vapi.
 *      - always                               → hand to Vapi.
 *   4. Speak the disclosure + recording-consent opener via <Say>.
 *   5. <Connect><Stream> the audio to Vapi's media URL with the
 *      assistant id the org configured.
 *
 * No call_logs row is inserted here — the call-end webhook owns
 * persistence after the call completes (we have proper duration,
 * transcript, recording URL, outcome).
 *
 * NOTE: The actual <Connect><Stream> URL depends on Vapi's account
 * setup. The owner sets call_agent_assistant_id via the setup
 * script; if it's missing we fall back to forwarding the call to
 * `call_agent_fallback_e164` so callers never hit a dead air.
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { blockedReason } from '@/lib/billing/org-access'
import {
  verifyTwilioSignature,
  newVoiceResponse,
  twimlResponse,
} from '@/lib/twilio'
import { normalizePhone } from '@/lib/validators'
import {
  disclosureOpener,
  afterHoursOpener,
} from '@/lib/voice-agent/disclosure'

const VAPI_PHONE_RELAY_BASE = process.env.VAPI_PHONE_RELAY_URL ?? 'wss://api.vapi.ai/twilio/inbound_call'

export async function POST(req: Request) {
  // Twilio webhook bodies are application/x-www-form-urlencoded.
  const form = await req.formData()
  const params: Record<string, string> = {}
  for (const [k, v] of form.entries()) params[k] = String(v)

  if (!verifyTwilioSignature(req, params)) {
    console.warn('[twilio-voice] invalid signature')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 403 })
  }

  const toE164   = normalizePhone(params.To   ?? '') ?? params.To
  const fromE164 = normalizePhone(params.From ?? '') ?? params.From
  const callSid  = params.CallSid ?? ''

  // ── Resolve the org by To number. ──
  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select(`
      id, name, slug, timezone,
      call_agent_enabled, call_agent_mode, call_agent_fallback_e164,
      call_agent_greeting, call_agent_business_hours,
      call_agent_assistant_id, call_agent_baa_attested_at,
      plan_status, trial_ends_at
    `)
    .eq('twilio_phone_number', toE164)
    .maybeSingle()

  // Org not mapped, agent disabled, no BAA on file, or plan locked out
  // (canceled/suspended/lapsed trial — every inbound Layla call burns
  // billable Vapi + Twilio minutes) → hang up with a generic message.
  // We deliberately don't say "this clinic hasn't set up..." (privacy +
  // signal-leak).
  if (
    !org || !org.call_agent_enabled || !org.call_agent_baa_attested_at ||
    blockedReason(org.plan_status, org.trial_ends_at)
  ) {
    const r = newVoiceResponse()
    r.say('Sorry, this number isn\'t available right now. Please try again later.')
    r.hangup()
    return twimlResponse(r.toString())
  }

  // ── Decide route: agent vs fallback vs hangup. ──
  const decision = decideRoute({
    mode: org.call_agent_mode as 'off' | 'after_hours' | 'always',
    businessHours: org.call_agent_business_hours,
    timezone: org.timezone ?? 'America/New_York',
    now: new Date(),
    fallbackE164: org.call_agent_fallback_e164,
    assistantId: org.call_agent_assistant_id,
  })

  if (decision === 'forward') {
    const r = newVoiceResponse()
    // No disclosure for forwarded calls — the human on the other
    // end answers directly. Twilio handles the bridge.
    r.dial(org.call_agent_fallback_e164!)
    return twimlResponse(r.toString())
  }

  if (decision === 'hangup') {
    const r = newVoiceResponse()
    r.say('Sorry, we can\'t take your call right now. Please call back during business hours.')
    r.hangup()
    return twimlResponse(r.toString())
  }

  // ── Hand to Vapi. ──
  // Speak the disclosure opener via Twilio TTS before the media
  // bridge — keeps the legal disclosure under our control even if
  // Vapi's first utterance is delayed. Vapi-side `firstMessage` can
  // pick up the conversation from there.
  const r = newVoiceResponse()
  const greeting = (decision === 'after_hours_agent')
    ? afterHoursOpener(org.call_agent_greeting || org.name || 'this clinic')
    : disclosureOpener(org.call_agent_greeting || org.name || 'this clinic')
  r.say({ voice: 'Polly.Joanna' }, greeting)
  // The Vapi inbound endpoint expects the assistant id and the
  // caller's number as query params. Vapi's docs: append
  // ?assistantId=<id>&phoneNumber=<E164>. We also include a
  // metadata blob so the call-end webhook can correlate.
  const streamUrl = new URL(VAPI_PHONE_RELAY_BASE)
  streamUrl.searchParams.set('assistantId', org.call_agent_assistant_id!)
  streamUrl.searchParams.set('phoneNumber', fromE164)
  streamUrl.searchParams.set('orgId', org.id)
  streamUrl.searchParams.set('callSid', callSid)
  const connect = r.connect()
  connect.stream({ url: streamUrl.toString() })
  return twimlResponse(r.toString())
}

// ─── Routing helper ───────────────────────────────────────────
// Decides whether to forward, hand off to the agent, or hang up.
// Tested in isolation — pure function.

type RouteDecision =
  | 'forward'                // bridge to fallback_e164
  | 'agent'                  // hand off to Vapi (always mode)
  | 'after_hours_agent'      // hand off to Vapi (after_hours, currently closed)
  | 'hangup'                 // no good path

interface RouteInputs {
  mode:           'off' | 'after_hours' | 'always'
  businessHours:  unknown          // jsonb: { "0": [{start,end}], ... }
  timezone:       string
  now:            Date
  fallbackE164:   string | null
  assistantId:    string | null
}

export function decideRoute(input: RouteInputs): RouteDecision {
  if (input.mode === 'off') {
    return input.fallbackE164 ? 'forward' : 'hangup'
  }
  if (input.mode === 'always') {
    return input.assistantId ? 'agent' : (input.fallbackE164 ? 'forward' : 'hangup')
  }
  // after_hours: agent ONLY when currently outside business hours.
  const open = isWithinBusinessHours(input.now, input.businessHours, input.timezone)
  if (open) {
    return input.fallbackE164 ? 'forward' : 'hangup'
  }
  return input.assistantId ? 'after_hours_agent' : (input.fallbackE164 ? 'forward' : 'hangup')
}

/** Pure: is `now` inside the org's business hours? */
function isWithinBusinessHours(now: Date, raw: unknown, timezone: string): boolean {
  if (!raw || typeof raw !== 'object') return false
  // Extract clinic-local weekday + HH:MM.
  const weekdayShort = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, weekday: 'short',
  }).format(now)
  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  }
  const weekday = weekdayMap[weekdayShort]
  if (weekday === undefined) return false
  const timeStr = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(now)
  const [hh, mm] = timeStr.split(':').map(Number)
  const minutesNow = hh * 60 + mm
  const todays = (raw as Record<string, Array<{ start: string; end: string }>>)[String(weekday)]
  if (!Array.isArray(todays)) return false
  for (const win of todays) {
    const [sh, sm] = win.start.split(':').map(Number)
    const [eh, em] = win.end.split(':').map(Number)
    const sMin = sh * 60 + sm
    const eMin = eh * 60 + em
    if (minutesNow >= sMin && minutesNow < eMin) return true
  }
  return false
}
