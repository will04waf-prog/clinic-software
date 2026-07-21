import { describe, it, expect } from 'vitest'
import { normalizeName, matchContactsByName, parseExtraction, type ContactRow } from './voice-estimate'

const c = (id: string, first: string | null, last: string | null): ContactRow =>
  ({ id, first_name: first, last_name: last, phone: null })

describe('normalizeName', () => {
  it('strips diacritics and case', () => {
    expect(normalizeName('García')).toBe('garcia')
    expect(normalizeName('  MARÍA José ')).toBe('maria jose')
  })
})

describe('matchContactsByName', () => {
  const contacts = [
    c('1', 'María', 'García'),
    c('2', 'José', 'Martínez'),
    c('3', 'Ana', 'Garcia Lopez'),
  ]

  it('matches a spoken full name regardless of accents', () => {
    const hits = matchContactsByName('maria garcia', contacts)
    expect(hits.map(h => h.id)).toEqual(['1'])
  })

  it('strips honorifics like "la señora"', () => {
    // "la señora García" → both Garcías match → ambiguous (2 hits).
    const hits = matchContactsByName('la señora García', contacts)
    expect(hits).toHaveLength(2)
  })

  it('unique last-name hit', () => {
    const hits = matchContactsByName('señor Martínez', contacts)
    expect(hits.map(h => h.id)).toEqual(['2'])
  })

  it('no match for unknown names, short queries, empty', () => {
    expect(matchContactsByName('Rodríguez', contacts)).toHaveLength(0)
    expect(matchContactsByName('a', contacts)).toHaveLength(0)
    expect(matchContactsByName('', contacts)).toHaveLength(0)
  })

  it('NEVER matches by substring — the wrong-client review finding', () => {
    // 'Susana' contains 'ana' but must not match Ana; 'Galeana' must
    // not match anyone; a longer unrelated name must stay unmatched.
    const pool = [c('1', 'Ana', 'García'), c('2', 'Leo', 'Pérez')]
    expect(matchContactsByName('Susana López', pool)).toHaveLength(0)
    expect(matchContactsByName('Adriana Torres', pool)).toHaveLength(0)
    expect(matchContactsByName('Galeana', pool)).toHaveLength(0)
  })

  it('matches when the contact full name appears within a longer spoken phrase', () => {
    const pool = [c('1', 'Ana', 'García'), c('2', 'Leo', 'Pérez')]
    // Both name tokens spoken exactly → safe match even with extra words.
    expect(matchContactsByName('la señora Ana García de la casa azul', pool).map(h => h.id)).toEqual(['1'])
    expect(matchContactsByName('Ana García', pool).map(h => h.id)).toEqual(['1'])
  })
})

describe('parseExtraction', () => {
  const valid = {
    client_name: 'García',
    client_phone: null,
    title: 'Corte de césped semanal',
    line_items: [{ description: 'Corte de césped', quantity: 1, unit_price_cents: 18000 }],
    notes: null,
    recurrence: 'weekly',
  }

  it('parses clean JSON', () => {
    const out = parseExtraction(JSON.stringify(valid))
    expect(out?.title).toBe('Corte de césped semanal')
    expect(out?.line_items[0]?.unit_price_cents).toBe(18000)
    expect(out?.recurrence).toBe('weekly')
  })

  it('parses fenced JSON with prose around it', () => {
    const out = parseExtraction('Here you go:\n```json\n' + JSON.stringify(valid) + '\n```')
    expect(out?.title).toBe('Corte de césped semanal')
  })

  it('rejects garbage; tolerates LLM misfires field-by-field', () => {
    expect(parseExtraction('not json at all')).toBeNull()
    // Negative price → field .catch() → 0, not a whole-extraction reject.
    const neg = parseExtraction(JSON.stringify({
      ...valid,
      line_items: [{ description: 'x', quantity: 1, unit_price_cents: -5 }],
    }))
    expect(neg?.line_items[0]?.unit_price_cents).toBe(0)
    // Out-of-enum recurrence → null, rest survives.
    const badRec = parseExtraction(JSON.stringify({ ...valid, recurrence: 'daily' }))
    expect(badRec?.recurrence).toBeNull()
    expect(badRec?.title).toBe('Corte de césped semanal')
    // Explicit nulls and stringified numbers survive.
    const nully = parseExtraction(JSON.stringify({
      title: 'Limpieza',
      client_name: null,
      line_items: [{ description: 'Limpieza', quantity: '2', unit_price_cents: '9000' }],
    }))
    expect(nully?.line_items[0]?.quantity).toBe(2)
    expect(nully?.line_items[0]?.unit_price_cents).toBe(9000)
  })

  it('defaults quantity 1 and price 0 when omitted; caps absurd prices', () => {
    const out = parseExtraction(JSON.stringify({
      title: 'Limpieza profunda',
      line_items: [{ description: 'Limpieza profunda' }],
    }))
    expect(out?.line_items[0]?.quantity).toBe(1)
    expect(out?.line_items[0]?.unit_price_cents).toBe(0)
    const capped = parseExtraction(JSON.stringify({
      title: 'x',
      line_items: [{ description: 'x', quantity: 1, unit_price_cents: 999_999_999 }],
    }))
    expect(capped?.line_items[0]?.unit_price_cents).toBe(0) // over cap → catch → 0 → price-missing path
  })

  it('carries the not_estimate escape hatch', () => {
    const out = parseExtraction(JSON.stringify({ not_estimate: true, title: 'n/a', line_items: [] }))
    expect(out?.not_estimate).toBe(true)
    expect(out?.line_items).toHaveLength(0)
  })
})
