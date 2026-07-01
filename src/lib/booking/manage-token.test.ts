import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { signManageToken, verifyManageToken } from './manage-token'

const UUID = '11111111-2222-4333-8444-555555555555'
const SECRET = 'test-secret-at-least-16-chars'

describe('manage-token HMAC (audit M10 — the sole /manage auth gate)', () => {
  beforeEach(() => vi.stubEnv('MANAGE_TOKEN_SECRET', SECRET))
  afterEach(() => vi.unstubAllEnvs())

  it('round-trips: sign → verify returns the same consultation id', () => {
    expect(verifyManageToken(signManageToken(UUID))).toBe(UUID)
  })

  it('rejects a tampered payload (signature no longer matches)', () => {
    const [payload, sig] = signManageToken(UUID).split('.')
    const tampered = `${payload.slice(0, -1)}${payload.slice(-1) === 'A' ? 'B' : 'A'}.${sig}`
    expect(verifyManageToken(tampered)).toBeNull()
  })

  it('rejects a forged token (real payload + a signature from a different id)', () => {
    const good = signManageToken(UUID)
    const otherSig = signManageToken('99999999-2222-4333-8444-555555555555').split('.')[1]
    expect(verifyManageToken(`${good.split('.')[0]}.${otherSig}`)).toBeNull()
  })

  it('rejects a validly-signed token whose payload is not a UUID', () => {
    // signManageToken does not validate the shape, so this proves the
    // UUID gate in verify rejects it even with a correct signature.
    expect(verifyManageToken(signManageToken('not-a-uuid'))).toBeNull()
  })

  it('rejects malformed tokens without throwing', () => {
    expect(verifyManageToken('')).toBeNull()
    expect(verifyManageToken('no-dot')).toBeNull()
    expect(verifyManageToken('.onlysig')).toBeNull()
    expect(verifyManageToken('payload.')).toBeNull()
  })

  it('sign THROWS but verify RETURNS NULL when the secret is missing (no 500 on GET /manage/*)', () => {
    const token = signManageToken(UUID)
    vi.stubEnv('MANAGE_TOKEN_SECRET', '')
    expect(() => signManageToken(UUID)).toThrow()
    expect(verifyManageToken(token)).toBeNull()
  })

  it('a token signed under the old secret fails after rotation', () => {
    const token = signManageToken(UUID)
    vi.stubEnv('MANAGE_TOKEN_SECRET', 'a-completely-different-16plus-secret')
    expect(verifyManageToken(token)).toBeNull()
  })
})
