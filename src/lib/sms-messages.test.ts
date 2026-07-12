import { describe, it, expect } from 'vitest'
import { getTemplate, renderSmsForConsultation } from './sms-messages'

// The frozen med-spa confirmation literal (byte-identical baseline). If
// this string ever changes, a med-spa tenant's live SMS changed — that's
// the regression this suite exists to catch.
const MEDSPA_CONFIRMATION =
  'Hi {{first_name}}, your consultation with {{clinic_name}} is confirmed for {{date}} at {{time}}. {{manage_url}}Reply STOP to opt out.'

describe('getTemplate — med-spa byte-identical', () => {
  it('med-spa confirmation is the frozen English literal', () => {
    expect(getTemplate('confirmation', { vertical: 'medspa' }, 'en')).toBe(MEDSPA_CONFIRMATION)
  })

  it('med-spa never localizes — es lang still yields the English literal', () => {
    // A med-spa line is English-only; even if a contact were somehow
    // es-preferring, the default stays byte-identical.
    expect(getTemplate('confirmation', { vertical: 'medspa' }, 'es')).toBe(MEDSPA_CONFIRMATION)
  })

  it('med-spa honors a custom confirmation template unchanged', () => {
    const custom = 'Custom med-spa confirmation. Reply STOP to opt out.'
    expect(getTemplate('confirmation', { vertical: 'medspa', sms_template_confirmation: custom }, 'en')).toBe(custom)
  })

  it('null/unknown vertical falls back to med-spa', () => {
    expect(getTemplate('confirmation', { vertical: null }, 'en')).toBe(MEDSPA_CONFIRMATION)
    expect(getTemplate('confirmation', {}, 'en')).toBe(MEDSPA_CONFIRMATION)
  })
})

describe('getTemplate — non-med-spa vertical nouns', () => {
  it('trades English default uses "job"', () => {
    const t = getTemplate('confirmation', { vertical: 'trades' }, 'en')
    expect(t).toContain('your job with')
    expect(t).not.toContain('consultation')
  })

  it('trades Spanish default uses "trabajo"', () => {
    const t = getTemplate('confirmation', { vertical: 'trades' }, 'es')
    expect(t).toContain('trabajo')
    expect(t.toUpperCase()).toContain('STOP')
  })

  it('food Spanish default uses "pedido"', () => {
    expect(getTemplate('confirmation', { vertical: 'food' }, 'es')).toContain('pedido')
  })
})

describe('getTemplate — Spanish confirmation template selection', () => {
  it('es caller with an authored ES template uses it', () => {
    const t = getTemplate('confirmation', {
      vertical: 'trades',
      sms_template_confirmation: 'EN CUSTOM. Reply STOP.',
      sms_template_confirmation_es: 'ES CUSTOM. Responda STOP.',
    }, 'es')
    expect(t).toBe('ES CUSTOM. Responda STOP.')
  })

  it('es caller with no ES template falls back to the English custom template', () => {
    const t = getTemplate('confirmation', {
      vertical: 'trades',
      sms_template_confirmation: 'EN CUSTOM. Reply STOP.',
    }, 'es')
    expect(t).toBe('EN CUSTOM. Reply STOP.')
  })

  it('en caller ignores the ES template entirely', () => {
    const t = getTemplate('confirmation', {
      vertical: 'trades',
      sms_template_confirmation: 'EN CUSTOM. Reply STOP.',
      sms_template_confirmation_es: 'ES CUSTOM. Responda STOP.',
    }, 'en')
    expect(t).toBe('EN CUSTOM. Reply STOP.')
  })

  it('es caller, no custom at all → Spanish default (not the English one)', () => {
    const t = getTemplate('confirmation', { vertical: 'trades' }, 'es')
    expect(t).toContain('trabajo')
    expect(t).not.toContain('your job')
  })
})

describe('renderSmsForConsultation — med-spa rendering unchanged', () => {
  const org = { name: 'Glow Med Spa', timezone: 'America/New_York', vertical: 'medspa' as const }
  const scheduledAt = '2026-08-01T18:00:00.000Z'

  it('med-spa confirmation renders the consultation wording and no other-vertical nouns', () => {
    const out = renderSmsForConsultation('confirmation', org, { first_name: 'Ana' }, scheduledAt)
    expect(out).toContain('your consultation with Glow Med Spa is confirmed')
    expect(out).toContain('Reply STOP to opt out.')
    expect(out).not.toMatch(/\bjob\b|\btrabajo\b|\border\b|\bpedido\b/)
  })

  it('med-spa ignores an es-preferring contact (English output)', () => {
    const out = renderSmsForConsultation('confirmation', org, { first_name: 'Ana', preferred_language: 'es' }, scheduledAt)
    expect(out).toContain('your consultation with')
    expect(out).not.toContain('su ')
  })

  it('trades es contact gets Spanish job wording', () => {
    const out = renderSmsForConsultation(
      'confirmation',
      { name: 'Rivera Landscaping', timezone: 'America/New_York', vertical: 'trades' },
      { first_name: 'José', preferred_language: 'es' },
      scheduledAt,
    )
    expect(out).toContain('trabajo')
    expect(out).toContain('Rivera Landscaping')
  })
})
