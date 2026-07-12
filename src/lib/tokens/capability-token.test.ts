import { describe, it, expect, beforeAll } from 'vitest'
import { signCapabilityToken, verifyCapabilityToken } from './capability-token'

const ID = 'a1b2c3d4-e5f6-4788-9a0b-1c2d3e4f5061'
const OTHER = 'ffffffff-e5f6-4788-9a0b-1c2d3e4f5061'

beforeAll(() => {
  process.env.MANAGE_TOKEN_SECRET = 'test-secret-at-least-16-chars-long'
})

describe('capability-token (purpose-bound HMAC)', () => {
  it('signs and verifies a roundtrip', () => {
    const tok = signCapabilityToken('estimate_approve', ID)
    expect(verifyCapabilityToken('estimate_approve', tok)).toBe(ID)
  })

  it('REJECTS a token verified under a different purpose (no cross-replay)', () => {
    const tok = signCapabilityToken('estimate_approve', ID)
    expect(verifyCapabilityToken('invoice_pay', tok)).toBeNull()
  })

  it('rejects a tampered signature', () => {
    const tok = signCapabilityToken('estimate_approve', ID)
    const [payload] = tok.split('.')
    expect(verifyCapabilityToken('estimate_approve', `${payload}.AAAA`)).toBeNull()
  })

  it('rejects a swapped payload (id substitution)', () => {
    const good = signCapabilityToken('estimate_approve', ID)
    const other = signCapabilityToken('estimate_approve', OTHER)
    // graft other's payload onto good's signature
    const forged = `${other.split('.')[0]}.${good.split('.')[1]}`
    expect(verifyCapabilityToken('estimate_approve', forged)).toBeNull()
  })

  it('rejects malformed tokens', () => {
    for (const bad of ['', 'no-dot', '.', 'a.', '.b']) {
      expect(verifyCapabilityToken('estimate_approve', bad)).toBeNull()
    }
  })

  it('verify returns null (does not throw) when the secret is missing; sign throws', () => {
    const saved = process.env.MANAGE_TOKEN_SECRET
    const tok = signCapabilityToken('estimate_approve', ID)
    delete process.env.MANAGE_TOKEN_SECRET
    try {
      expect(verifyCapabilityToken('estimate_approve', tok)).toBeNull()
      expect(() => signCapabilityToken('estimate_approve', ID)).toThrow(/MANAGE_TOKEN_SECRET/)
    } finally {
      process.env.MANAGE_TOKEN_SECRET = saved
    }
  })
})
