/**
 * Phase 5 W1 — internal tool-call types.
 *
 * Provider-agnostic shape used by our /api/voice/tool/* endpoints.
 * Vapi posts a specific request shape ({ message: { type: 'tool-calls',
 * toolCallList: [...] }, call: {...}, ... }) but we don't want every
 * tool route reaching into that exact JSON layout — a future Retell
 * swap would force a rewrite. Instead, each route accepts both
 * shapes (Vapi today, generic v2 later) and normalizes to this
 * internal type before doing the actual work.
 *
 * The response shape mirrors Vapi's expected `{ results: [{ toolCallId,
 * result }] }` because that's the shipping target — but the
 * internal helper returns a plain `{ ok, output, error? }` so the
 * route's normalization layer maps it.
 */

export interface NormalizedToolCall {
  /** Vapi's toolCallId. Echoed back in the response so Vapi can
   *  match the result to the call. */
  toolCallId: string
  /** The function name we registered with Vapi (e.g. 'get_context',
   *  'lookup_availability', 'create_hold', 'confirm_booking'). */
  name: string
  /** The parsed arguments object. Vapi sends a stringified JSON but
   *  many SDKs parse before forwarding — we accept either shape via
   *  toolCallFromVapiPayload(). */
  arguments: Record<string, unknown>
  /** The Twilio Call SID for this call (Vapi forwards it). Used to
   *  scope rate-limit + idempotency. */
  callSid?: string
  /** The Twilio call's `to` number, used to resolve the org. */
  toE164?: string
  /** The caller's number (Twilio `from`). Used by tools that look up
   *  the caller as an existing contact (e.g. lookup_my_appointments).
   *  Caller ID isn't strong identity proof, but for an existing
   *  patient calling from their own phone it's the same signal a
   *  human receptionist uses ("is this Sarah?"). */
  fromE164?: string
  /** The Vapi assistant id handling the call. Web (browser) calls
   *  carry no phone numbers at all — this is the only handle the
   *  envelope resolver has to map a web-demo call onto the demo
   *  clinic (see resolve-envelope.ts). */
  assistantId?: string
}

export interface ToolCallResultOk {
  ok: true
  output: unknown
}
export interface ToolCallResultError {
  ok: false
  error: string
}
export type ToolCallResult = ToolCallResultOk | ToolCallResultError

/**
 * Normalize a Vapi tool-call webhook payload into NormalizedToolCall.
 * Returns null if the payload doesn't match the expected shape — the
 * route should 400 in that case.
 *
 * Vapi has two related payload shapes depending on dashboard version:
 *   - { message: { type:'tool-calls', toolCallList:[{id, function:{name, arguments}}]}, call:{phoneNumber:{...}, customer:{number}}}
 *   - { type:'function-call', functionCall:{name, parameters}, call:{...} }
 *
 * We try both. For W1 we only ever expect ONE tool call per
 * request (Vapi batches but we don't use that), so we return the
 * first element.
 */
// Vapi has shifted these fields around dashboard versions:
//   - phoneNumber.number = the receiving (clinic) number → toE164
//   - customer.number    = the caller's number          → fromE164
// Older payloads put them under `b.call.*`; newer payloads put them
// under `b.message.*` as siblings of `call`; some put them at the
// envelope root. Walk all three so we don't silently lose the
// caller-id whenever Vapi rearranges the schema.
function pickPhone(b: Record<string, any>, key: 'phoneNumber' | 'customer'): string | undefined {
  const candidates = [
    b?.call?.[key]?.number,
    b?.message?.call?.[key]?.number,
    b?.message?.[key]?.number,
    b?.[key]?.number,
  ]
  for (const v of candidates) {
    if (typeof v === 'string' && v.length > 0) return v
  }
  return undefined
}

// Same schema-drift defense as pickPhone: Vapi has moved the
// assistant reference between call.assistantId and assistant.id
// across dashboard versions.
function pickAssistantId(b: Record<string, any>): string | undefined {
  const candidates = [
    b?.call?.assistantId,
    b?.message?.call?.assistantId,
    b?.call?.assistant?.id,
    b?.message?.assistant?.id,
    b?.assistant?.id,
  ]
  for (const v of candidates) {
    if (typeof v === 'string' && v.length > 0) return v
  }
  return undefined
}

export function toolCallFromVapiPayload(body: unknown): NormalizedToolCall | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, any>

  // Shape A: { message: { type:'tool-calls', toolCallList:[...]}, call:{...} }
  const msg = b.message
  if (msg && msg.type === 'tool-calls' && Array.isArray(msg.toolCallList) && msg.toolCallList.length > 0) {
    const tc = msg.toolCallList[0]
    if (!tc || !tc.id || !tc.function) return null
    let args: Record<string, unknown> = {}
    const raw = tc.function.arguments
    if (typeof raw === 'string') {
      try { args = JSON.parse(raw) } catch { args = {} }
    } else if (raw && typeof raw === 'object') {
      args = raw as Record<string, unknown>
    }
    return {
      toolCallId: String(tc.id),
      name:       String(tc.function.name ?? ''),
      arguments:  args,
      callSid:    b.call?.id ?? b.message?.call?.id ? String(b.call?.id ?? b.message?.call?.id) : undefined,
      toE164:     pickPhone(b, 'phoneNumber'),
      fromE164:   pickPhone(b, 'customer'),
      assistantId: pickAssistantId(b),
    }
  }

  // Shape B: { type:'function-call', functionCall:{name, parameters}, call:{...} }
  if (b.type === 'function-call' && b.functionCall && typeof b.functionCall === 'object') {
    const fc = b.functionCall
    return {
      toolCallId: String(b.id ?? b.callId ?? 'unknown'),
      name:       String(fc.name ?? ''),
      arguments:  (fc.parameters && typeof fc.parameters === 'object') ? fc.parameters as Record<string, unknown> : {},
      callSid:    b.call?.id ? String(b.call.id) : undefined,
      toE164:     pickPhone(b, 'phoneNumber'),
      fromE164:   pickPhone(b, 'customer'),
      assistantId: pickAssistantId(b),
    }
  }

  return null
}

/**
 * Build the Vapi-shaped tool-call response. Vapi expects:
 *   { results: [{ toolCallId, result: <string> }] }
 * where `result` is a STRING the LLM is given as the tool output —
 * we JSON.stringify the output so the LLM gets structured data it
 * can reason about.
 */
export function toolCallResponseForVapi(toolCallId: string, result: ToolCallResult): unknown {
  const payload = result.ok ? result.output : { error: result.error }
  return {
    results: [{ toolCallId, result: JSON.stringify(payload) }],
  }
}
