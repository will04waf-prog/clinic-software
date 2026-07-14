import { describe, it, expect } from 'vitest'
import { checkGuardrails } from './ai-twin'

describe('checkGuardrails — vertical-gated med-spa compliance', () => {
  const priced = 'Sure! A weekly mow runs about $80 and cleanup is $40.'

  it('med-spa (explicit) still BLOCKS quoted prices — compliance preserved', () => {
    expect(checkGuardrails(priced, { vertical: 'medspa' })).toEqual({
      ok: false,
      violation: 'quoted_price',
    })
  })

  it('legacy callers (no vertical) still BLOCK prices — default unchanged', () => {
    expect(checkGuardrails(priced).ok).toBe(false)
    expect(checkGuardrails(priced, {}).ok).toBe(false)
  })

  it('landscaping ALLOWS quoting a price — the whole job', () => {
    expect(checkGuardrails(priced, { vertical: 'landscaping' })).toEqual({ ok: true })
  })

  it('trades ALLOWS prices + dose-shaped units (e.g. "20 units of X")', () => {
    expect(checkGuardrails('Install is $500, includes 2 units.', { vertical: 'trades' })).toEqual({ ok: true })
  })

  it('universal rules (length) still apply regardless of vertical', () => {
    const tooLong = 'x'.repeat(200)
    expect(checkGuardrails(tooLong, { vertical: 'landscaping' }).ok).toBe(false)
  })
})
