import { describe, it, expect } from 'vitest'
import { opsAlertIdempotencyKey } from './ops-alert'

describe('opsAlertIdempotencyKey', () => {
  it('same key within the same hour → same idempotency key (Resend dedups)', () => {
    const a = opsAlertIdempotencyKey('cron-main', new Date('2026-07-09T14:05:00Z'))
    const b = opsAlertIdempotencyKey('cron-main', new Date('2026-07-09T14:59:59Z'))
    expect(a).toBe(b)
  })

  it('same key across an hour boundary → different keys (one alert per hour)', () => {
    const a = opsAlertIdempotencyKey('cron-main', new Date('2026-07-09T14:59:59Z'))
    const b = opsAlertIdempotencyKey('cron-main', new Date('2026-07-09T15:00:01Z'))
    expect(a).not.toBe(b)
  })

  it('different alert keys never collide within the same hour', () => {
    const now = new Date('2026-07-09T14:30:00Z')
    expect(opsAlertIdempotencyKey('cron-main', now))
      .not.toBe(opsAlertIdempotencyKey('cron-voice-reminders', now))
  })
})
