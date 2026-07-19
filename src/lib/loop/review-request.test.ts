import { describe, it, expect } from 'vitest'
import { parsePlaceIdInput, reviewLinkFromPlaceId, classifyReviewReply } from './review-request'

describe('parsePlaceIdInput', () => {
  it('accepts a bare Place ID', () => {
    expect(parsePlaceIdInput('ChIJN1t_tDeuEmsRUsoyG83frY4')).toBe('ChIJN1t_tDeuEmsRUsoyG83frY4')
  })

  it('trims whitespace around a bare id', () => {
    expect(parsePlaceIdInput('  ChIJN1t_tDeuEmsRUsoyG83frY4  ')).toBe('ChIJN1t_tDeuEmsRUsoyG83frY4')
  })

  it('extracts placeid from the writereview URL', () => {
    expect(parsePlaceIdInput('https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4'))
      .toBe('ChIJN1t_tDeuEmsRUsoyG83frY4')
  })

  it('accepts the place_id param spelling', () => {
    expect(parsePlaceIdInput('https://example.google.com/maps?place_id=ChIJN1t_tDeuEmsRUsoyG83frY4'))
      .toBe('ChIJN1t_tDeuEmsRUsoyG83frY4')
  })

  it('rejects URLs without a placeid param', () => {
    expect(parsePlaceIdInput('https://g.page/r/shortlink/review')).toBeNull()
  })

  it('rejects garbage and empty input', () => {
    expect(parsePlaceIdInput('')).toBeNull()
    expect(parsePlaceIdInput('   ')).toBeNull()
    expect(parsePlaceIdInput('not a place id!')).toBeNull()
    expect(parsePlaceIdInput('short')).toBeNull()
  })

  it('round-trips into the review link', () => {
    const pid = parsePlaceIdInput('ChIJN1t_tDeuEmsRUsoyG83frY4')!
    expect(reviewLinkFromPlaceId(pid)).toBe(
      'https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4',
    )
  })
})

describe('classifyReviewReply', () => {
  it('maps button payloads', () => {
    expect(classifyReviewReply('review_ok', undefined)).toBe('ok')
    expect(classifyReviewReply('review_issue', undefined)).toBe('issue')
  })

  it('payload wins over body text', () => {
    expect(classifyReviewReply('review_issue', 'Todo excelente')).toBe('issue')
  })

  it('maps typed-out button text in both languages, case-insensitive', () => {
    expect(classifyReviewReply(undefined, 'Todo excelente')).toBe('ok')
    expect(classifyReviewReply(undefined, 'todo excelente')).toBe('ok')
    expect(classifyReviewReply(undefined, 'All great')).toBe('ok')
    expect(classifyReviewReply(undefined, 'Hubo un problema')).toBe('issue')
    expect(classifyReviewReply(undefined, 'There was a problem')).toBe('issue')
  })

  it('returns null for anything else (free chat is not a gate answer)', () => {
    expect(classifyReviewReply(undefined, 'gracias, ¿me manda el estimado?')).toBeNull()
    expect(classifyReviewReply(undefined, '')).toBeNull()
    expect(classifyReviewReply(undefined, undefined)).toBeNull()
    expect(classifyReviewReply('something_else', 'hola')).toBeNull()
  })
})
