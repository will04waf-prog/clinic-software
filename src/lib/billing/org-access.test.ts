import { describe, it, expect } from 'vitest'
import { blockedReason } from './org-access'

const NOW = new Date('2026-07-02T12:00:00Z')
const FUTURE = '2026-07-10T00:00:00Z'
const PAST = '2026-06-20T00:00:00Z'

describe('blockedReason', () => {
  it('active org is not blocked', () => {
    expect(blockedReason('active', null, NOW)).toBeNull()
    expect(blockedReason('active', PAST, NOW)).toBeNull() // trial_ends_at is irrelevant once active
  })

  it('in-window trial is not blocked', () => {
    expect(blockedReason('trial', FUTURE, NOW)).toBeNull()
  })

  it('lapsed trial is blocked even before the expire-trials cron flips it', () => {
    expect(blockedReason('trial', PAST, NOW)).toBe('trial_expired')
  })

  it('trial_expired is blocked', () => {
    expect(blockedReason('trial_expired', null, NOW)).toBe('trial_expired')
    expect(blockedReason('trial_expired', FUTURE, NOW)).toBe('trial_expired')
  })

  it('canceled and suspended are blocked regardless of trial_ends_at', () => {
    expect(blockedReason('canceled', null, NOW)).toBe('canceled')
    expect(blockedReason('canceled', FUTURE, NOW)).toBe('canceled')
    expect(blockedReason('suspended', null, NOW)).toBe('suspended')
  })

  it('past_due is a grace period, not a lockout', () => {
    expect(blockedReason('past_due', PAST, NOW)).toBeNull()
  })

  it('uninitialized trial (null/garbage trial_ends_at) fails open — org-tier already downgrades it', () => {
    expect(blockedReason('trial', null, NOW)).toBeNull()
    expect(blockedReason('trial', 'not-a-date', NOW)).toBeNull()
  })

  it('null/undefined/unknown status is not blocked (fail-safe handled at tier layer)', () => {
    expect(blockedReason(null, null, NOW)).toBeNull()
    expect(blockedReason(undefined, undefined, NOW)).toBeNull()
    expect(blockedReason('something_new', null, NOW)).toBeNull()
  })
})
