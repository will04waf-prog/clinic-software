/**
 * Phase 4 W5 — signed "manage your booking" tokens.
 *
 * A patient who booked publicly via /book/[slug] gets a confirmation
 * SMS containing a /manage/[token] link. The link resolves to a page
 * where they can pick a new slot or cancel — without calling the
 * clinic.
 *
 * Design choices:
 *   - The token encodes ONLY the consultation_id, signed with a
 *     server-side secret via HMAC-SHA256. We do NOT bake the
 *     scheduled_at or status into the payload, so the same token
 *     stays valid AFTER a reschedule. (If we encoded the slot, a
 *     reschedule would have to re-send a fresh SMS with a fresh
 *     link — twice the SMS spend, awkward for the patient.)
 *   - No expiry baked into the token either. Authoritative state
 *     lives on the consultation row — once the row is `cancelled` or
 *     the scheduled_at is in the past, the /manage page short-circuits
 *     with an appropriate message. The token itself is a capability,
 *     not a session.
 *   - URL-safe base64 (no padding) so the token sits cleanly in an
 *     SMS without URL-encoding noise.
 *
 * Threat model:
 *   - Attacker who guesses a UUID + the secret can manage someone
 *     else's booking. The secret is the gate. Rotate by setting
 *     MANAGE_TOKEN_SECRET to a fresh value — already-sent links break,
 *     which is the correct semantics for compromise.
 *   - Without the secret env var, signing and verification BOTH throw.
 *     We don't want to silently fall back to an insecure default that
 *     a misconfigured prod could ship.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

function getSecret(): string {
  const s = process.env.MANAGE_TOKEN_SECRET
  if (!s || s.length < 16) {
    throw new Error(
      'MANAGE_TOKEN_SECRET is missing or too short (need ≥16 chars). Set it in env before signing or verifying manage tokens.',
    )
  }
  return s
}

function b64urlEncode(buf: Buffer | string): string {
  const b = typeof buf === 'string' ? Buffer.from(buf, 'utf8') : buf
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(s: string): Buffer {
  // Pad back out for standard base64 decoding.
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64')
}

/**
 * Sign a consultation_id into an opaque, URL-safe token. The token
 * is `b64url(consultation_id) + '.' + b64url(hmac)`. Decoders need
 * only the secret to verify — no per-row state.
 */
export function signManageToken(consultationId: string): string {
  const payload = b64urlEncode(consultationId)
  const mac = createHmac('sha256', getSecret()).update(payload).digest()
  return `${payload}.${b64urlEncode(mac)}`
}

/**
 * Verify a token and return the consultation_id, or null if the
 * signature doesn't check out / the token is malformed. Uses a
 * constant-time compare so the verification path doesn't leak
 * signature bytes through timing.
 *
 * Does NOT check the consultation row — caller resolves the row
 * separately and applies its own business rules (already cancelled,
 * already past, etc.).
 */
export function verifyManageToken(token: string): string | null {
  if (typeof token !== 'string' || token.length === 0) return null
  const dot = token.indexOf('.')
  if (dot < 1 || dot === token.length - 1) return null

  const payload = token.slice(0, dot)
  const signature = token.slice(dot + 1)

  let providedMac: Buffer
  try {
    providedMac = b64urlDecode(signature)
  } catch {
    return null
  }

  let secret: string
  try {
    secret = getSecret()
  } catch {
    // Re-raise as null from the caller's perspective — verification
    // can't succeed without a secret, but we don't want an unrelated
    // GET /manage/[anything] to 500. The downstream not-found path
    // is the right surface.
    return null
  }

  const expectedMac = createHmac('sha256', secret).update(payload).digest()
  if (providedMac.length !== expectedMac.length) return null
  if (!timingSafeEqual(providedMac, expectedMac)) return null

  const consultationId = b64urlDecode(payload).toString('utf8')
  // UUID shape sanity check — the URL came from us, so this should
  // always hold. Defensive only.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(consultationId)) {
    return null
  }
  return consultationId
}
