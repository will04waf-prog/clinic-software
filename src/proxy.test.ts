import { describe, it, expect } from 'vitest'
import { matchesRoute, PUBLIC_ROUTES, STATIC_PUBLIC } from './proxy'

describe('matchesRoute — public-route classification (auth boundary)', () => {
  it('REGRESSION: /estimates is NOT public despite the /es prefix collision', () => {
    // The original bug: '/estimates'.startsWith('/es') === true, so the
    // authenticated estimates section skipped login + plan-lockout.
    expect(matchesRoute('/estimates', PUBLIC_ROUTES)).toBe(false)
    expect(matchesRoute('/estimates/abc-123', PUBLIC_ROUTES)).toBe(false)
    expect(matchesRoute('/estimates', STATIC_PUBLIC)).toBe(false)
  })

  it('the real /es marketing route (and its children) IS public', () => {
    expect(matchesRoute('/es', PUBLIC_ROUTES)).toBe(true)
    expect(matchesRoute('/es/', PUBLIC_ROUTES)).toBe(true)
    expect(matchesRoute('/es/anything', PUBLIC_ROUTES)).toBe(true)
  })

  it('other authenticated sections are not accidentally public', () => {
    for (const p of ['/dashboard', '/invoices', '/invoices/1', '/clients', '/schedule', '/settings']) {
      expect(matchesRoute(p, PUBLIC_ROUTES)).toBe(false)
    }
  })

  it('genuinely public routes match exactly and at boundaries', () => {
    expect(matchesRoute('/login', PUBLIC_ROUTES)).toBe(true)
    expect(matchesRoute('/pagar/tok', PUBLIC_ROUTES)).toBe(true)
    expect(matchesRoute('/aprobar/tok', PUBLIC_ROUTES)).toBe(true)
    expect(matchesRoute('/book/slug', PUBLIC_ROUTES)).toBe(true)
    // /book-demo is its own entry, not a child of /book
    expect(matchesRoute('/book-demo', PUBLIC_ROUTES)).toBe(true)
  })

  it('a prefix must not match a longer unrelated segment', () => {
    // '/demo' is public; '/democracy' must not inherit it
    expect(matchesRoute('/democracy', PUBLIC_ROUTES)).toBe(false)
    // '/billing' is public; '/billings-report' must not
    expect(matchesRoute('/billings-report', PUBLIC_ROUTES)).toBe(false)
  })
})
