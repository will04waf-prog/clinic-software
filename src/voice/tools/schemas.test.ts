import { describe, it, expect } from 'vitest'
import { TOOL_POST_CALL_SUMMARY_EMAIL, TOOL_SEND_LINK_SMS } from './schemas'

// Multi-vertical Phase 2 — the bilingual affordances the model relies
// on must exist on the tool schemas, and stay OPTIONAL so English-only
// calls (and existing med-spa tenants) are unaffected.
describe('bilingual tool affordances (Phase 2)', () => {
  it('post_call_summary_email exposes an optional detected_language enum', () => {
    const props = TOOL_POST_CALL_SUMMARY_EMAIL.function.parameters.properties as Record<string, { enum?: string[] }>
    expect(props.detected_language?.enum).toEqual(['en', 'es'])
    const required = (TOOL_POST_CALL_SUMMARY_EMAIL.function.parameters.required ?? []) as string[]
    expect(required).not.toContain('detected_language') // optional — omitted on English-only calls
  })

  it('send_link_sms exposes an optional language enum', () => {
    const props = TOOL_SEND_LINK_SMS.function.parameters.properties as Record<string, { enum?: string[] }>
    expect(props.language?.enum).toEqual(['en', 'es'])
    const required = (TOOL_SEND_LINK_SMS.function.parameters.required ?? []) as string[]
    expect(required).toEqual(['link_kind', 'consent_confirmed']) // language stays optional
  })
})
