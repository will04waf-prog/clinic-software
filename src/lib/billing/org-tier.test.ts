import { describe, it, expect } from 'vitest'
import { effectiveTierFor } from './org-tier'

const NOW = new Date('2026-07-02T12:00:00Z')
const FUTURE = '2026-07-10T00:00:00Z'
const PAST = '2026-06-20T00:00:00Z'

describe('effectiveTierFor — trial rule (setup-status depends on this)', () => {
  it('in-window trial is Scale-equivalent regardless of plan', () => {
    const et = effectiveTierFor('trial', 'trial', FUTURE, NOW)
    expect(et.tier).toBe('scale')
    expect(et.reason).toBe('trial')
    expect(et.limits.allowsCallAgent).toBe(true)
    expect(et.limits.allowsVoiceTraining).toBe(true)
  })

  it('lapsed trial falls back to plan mapping (trial plan → professional)', () => {
    const et = effectiveTierFor('trial', 'trial', PAST, NOW)
    expect(et.tier).toBe('professional')
    expect(et.reason).toBe('plan')
  })

  it("plan_status='active' with plan='trial' maps to professional, never Scale (the pre-fix signup state)", () => {
    const et = effectiveTierFor('trial', 'active', FUTURE, NOW)
    expect(et.tier).toBe('professional')
    expect(et.limits.allowsCallAgent).toBe(false)
  })

  it('paid plans map to their own tier', () => {
    expect(effectiveTierFor('starter', 'active', null, NOW).tier).toBe('starter')
    expect(effectiveTierFor('professional', 'active', null, NOW).tier).toBe('professional')
    expect(effectiveTierFor('scale', 'active', null, NOW).tier).toBe('scale')
  })
})
