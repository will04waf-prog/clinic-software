/**
 * Purpose-bound HMAC-SHA256 capability tokens for the CRM-pivot public
 * links (estimate approval, invoice pay). Generalizes the proven
 * booking/manage-token pattern with one addition: a `purpose` tag folded
 * into the signed material, so a token minted for one purpose (e.g.
 * 'estimate_approve') can NEVER verify against another ('invoice_pay') —
 * even under the same secret.
 *
 * Token = b64url(id) + '.' + b64url(HMAC(`${purpose}:${id}`)).
 * The purpose is not in the URL — only the id and the MAC are — but the
 * MAC covers the purpose, so binding is cryptographic, not cosmetic.
 *
 * Design (mirrors manage-token.ts):
 *   - Capability, not session: no expiry baked in. Authoritative state
 *     lives on the row (an approved estimate short-circuits; a paid
 *     invoice short-circuits). The token is a bearer capability.
 *   - Reuses MANAGE_TOKEN_SECRET (already provisioned). Safe to share:
 *     the purpose tag makes these tokens disjoint from manage tokens,
 *     which sign a bare id with no purpose.
 *   - Without the secret, sign THROWS and verify RETURNS NULL — a
 *     misconfigured prod must never fall back to an insecure default,
 *     and a GET on a public page must never 500 for lack of a secret.
 *   - Constant-time compare; UUID-shape sanity check on decode.
 *
 * The legacy /manage flow keeps using manage-token.ts unchanged.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

export type TokenPurpose = 'estimate_approve' | 'invoice_pay' | 'calendar_feed'

function getSecret(): string {
  const s = process.env.MANAGE_TOKEN_SECRET
  if (!s || s.length < 16) {
    throw new Error('MANAGE_TOKEN_SECRET is missing or too short (need ≥16 chars).')
  }
  return s
}

function b64urlEncode(buf: Buffer | string): string {
  const b = typeof buf === 'string' ? Buffer.from(buf, 'utf8') : buf
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64')
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Sign `id` bound to `purpose` into an opaque, URL-safe token. */
export function signCapabilityToken(purpose: TokenPurpose, id: string): string {
  const payload = b64urlEncode(id)
  const mac = createHmac('sha256', getSecret()).update(`${purpose}:${id}`).digest()
  return `${payload}.${b64urlEncode(mac)}`
}

/** Verify a token for the EXPECTED purpose; returns the id or null. */
export function verifyCapabilityToken(purpose: TokenPurpose, token: string): string | null {
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
    // No 500 on a public GET; the not-found path is the right surface.
    return null
  }

  let id: string
  try {
    id = b64urlDecode(payload).toString('utf8')
  } catch {
    return null
  }
  if (!UUID_RE.test(id)) return null

  const expectedMac = createHmac('sha256', secret).update(`${purpose}:${id}`).digest()
  if (providedMac.length !== expectedMac.length) return null
  if (!timingSafeEqual(providedMac, expectedMac)) return null

  return id
}
