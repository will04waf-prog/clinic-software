import { describe, it, expect } from 'vitest'
import { dict, resolveLocale, DEFAULT_LOCALE } from './index'
import { es } from './es'
import { en } from './en'

// Recursively collect the key structure + leaf types of a message object,
// so es and en are proven to have identical shape (a string in one locale
// must be a string in the other, a function must be a function).
function shape(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) => {
    const path = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'object' && v !== null) return shape(v as Record<string, unknown>, path)
    return [`${path}:${typeof v}`]
  }).sort()
}

describe('i18n dictionary', () => {
  it('default locale is Spanish', () => {
    expect(DEFAULT_LOCALE).toBe('es')
    expect(dict()).toBe(es)
  })

  it('resolveLocale coerces to es for anything but explicit en', () => {
    expect(resolveLocale('en')).toBe('en')
    expect(resolveLocale('es')).toBe('es')
    expect(resolveLocale(null)).toBe('es')
    expect(resolveLocale('fr')).toBe('es')
    expect(resolveLocale(undefined)).toBe('es')
  })

  it('es and en have identical key structure and leaf types', () => {
    expect(shape(en as unknown as Record<string, unknown>))
      .toEqual(shape(es as unknown as Record<string, unknown>))
  })

  it('interpolating messages render in both locales', () => {
    expect(dict('es').signup.trialNote(14)).toContain('14')
    expect(dict('en').signup.trialNote(14)).toContain('14')
    expect(dict('es').onboarding.welcomeTitle('José')).toContain('José')
  })
})
