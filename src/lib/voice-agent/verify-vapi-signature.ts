/**
 * Phase 5 W1 — verify that an incoming webhook is genuinely from
 * Vapi.
 *
 * Vapi signs tool-call + call-event webhooks with a shared secret
 * (configured at Dashboard → Server URL → Secret). They send the
 * value back in the x-vapi-secret header on every request.
 *
 * Verification is a constant-time string compare — the secret IS
 * the signature, no per-request HMAC like Twilio. If you rotate
 * the secret in Vapi, our env must be updated in lockstep.
 *
 * Returns:
 *   - true  → signature matches OR we're running without a
 *             configured secret (dev fallback).
 *   - false → secret is set but the header doesn't match. Caller
 *             should return 401.
 *
 * The "no secret configured" branch logs a warning so we don't
 * silently accept forged requests in prod. The intended posture:
 * leave VAPI_WEBHOOK_SECRET unset during initial dev, set it
 * before routing real patient calls.
 */

import { timingSafeEqual } from 'node:crypto'

let warnedNoSecret = false

export function verifyVapiSignature(request: Request): boolean {
  const expected = process.env.VAPI_WEBHOOK_SECRET
  if (!expected) {
    // In production a missing secret is a deploy-time misconfiguration
    // and must fail closed — the previous behavior (return true + warn)
    // silently auth-bypassed every voice tool. In dev/test we keep the
    // soft-pass so local exploration works without env juggling.
    if (!warnedNoSecret) {
      console.warn('[vapi] VAPI_WEBHOOK_SECRET is not set. In production this fails closed; only dev/test soft-passes.')
      warnedNoSecret = true
    }
    return process.env.NODE_ENV !== 'production'
  }

  const got = request.headers.get('x-vapi-secret') ?? ''
  if (got.length !== expected.length) return false
  try {
    return timingSafeEqual(Buffer.from(got), Buffer.from(expected))
  } catch {
    return false
  }
}
