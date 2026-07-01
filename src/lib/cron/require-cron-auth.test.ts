import { describe, it, expect, beforeEach, vi } from 'vitest'
import { requireCronAuth } from './require-cron-auth'

const req = (headers: Record<string, string> = {}) =>
  new Request('https://tarhunna.net/api/cron', { headers })

describe('requireCronAuth (audit M1 — crons must not fail open)', () => {
  beforeEach(() => vi.unstubAllEnvs())

  it('allows a request carrying the correct Bearer secret', () => {
    vi.stubEnv('CRON_SECRET', 's3cret')
    expect(requireCronAuth(req({ authorization: 'Bearer s3cret' }))).toBeNull()
  })

  it('rejects a wrong or missing Bearer with 401 when the secret is set', () => {
    vi.stubEnv('CRON_SECRET', 's3cret')
    expect(requireCronAuth(req({ authorization: 'Bearer nope' }))?.status).toBe(401)
    expect(requireCronAuth(req())?.status).toBe(401)
  })

  it('FAILS CLOSED (500) in production when CRON_SECRET is unset', () => {
    vi.stubEnv('CRON_SECRET', '')
    vi.stubEnv('NODE_ENV', 'production')
    expect(requireCronAuth(req())?.status).toBe(500)
  })

  it('allows in non-production when CRON_SECRET is unset (local/manual triggers)', () => {
    vi.stubEnv('CRON_SECRET', '')
    vi.stubEnv('NODE_ENV', 'development')
    expect(requireCronAuth(req())).toBeNull()
  })
})
