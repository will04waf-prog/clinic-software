/**
 * Voice profile — per-org voice tuning for AI Twin drafts.
 *
 * Lives on organizations.ai_twin_voice_profile (jsonb column, default
 * '{}'). We chose jsonb over discrete columns so future Phase 2 work
 * (W8 edit-pattern auto-tuning) can extend the shape without
 * per-field migrations.
 *
 * Phase 2 W6 stored it. Phase 2 W7 wires it into generateDraft() —
 * see src/lib/ai-twin.ts.
 */

import { z } from 'zod'

// ─── Message class taxonomy ────────────────────────────────────────
//
// The class enum matches the DB CHECK constraint on voice_examples.class.
// Order matters for UI listings and fallback walks below.

export const VOICE_EXAMPLE_CLASSES = [
  'greeting',
  'faq',
  'follow_up',
  'consult_confirm',
  'follow_up_cold',
  'custom',
] as const

export type VoiceExampleClass = typeof VOICE_EXAMPLE_CLASSES[number]

/**
 * Human-readable labels — single source of truth for UI surfaces and
 * the voice-health aggregator. Adding a class to the enum forces TS
 * to surface a missing label here.
 */
export const VOICE_CLASS_LABEL: Record<VoiceExampleClass, string> = {
  greeting:        'Welcome / first reply',
  faq:             'Answering a question',
  follow_up:       'Follow-up nudge',
  consult_confirm: 'Consult confirmation',
  follow_up_cold:  'Re-engaging cold lead',
  custom:          'Other',
}

/**
 * When the requested class has fewer than 3 matching examples, walk
 * these fallback classes (in order) to fill the slots. 'custom' is
 * never used as a fallback target — it's a catch-all bucket the
 * clinic owner uses, and the semantics are unknown to us.
 */
export const FALLBACK_CLASS_ORDER: Record<VoiceExampleClass, VoiceExampleClass[]> = {
  greeting:        ['faq', 'follow_up'],
  faq:             ['greeting', 'follow_up'],
  follow_up:       ['follow_up_cold', 'faq'],
  consult_confirm: ['follow_up', 'faq'],
  follow_up_cold:  ['follow_up', 'faq'],
  custom:          ['faq', 'follow_up'],
}

// Tone sliders are 0-100. 0 and 100 are the extremes the user reads
// as the slider labels; everything in between is a blend.
//
// formal:   0 = casual ("Hey Sarah!")           100 = formal ("Dear Sarah,")
// warm:     0 = warm   ("So glad you reached!") 100 = clinical ("Acknowledged.")
//
// Defaults reflect the current SMS prompt's "warm, professional" baseline.
export const DEFAULT_TONE_FORMAL = 55
export const DEFAULT_TONE_WARM   = 25

export const MAX_BANNED_PHRASES = 30
export const MAX_BANNED_PHRASE_LEN = 60
export const MAX_SIGNOFF_LEN = 80

// Minimum banned-phrase length. Single chars or short stop-words
// like "a", "the", "you" would brick every draft via the
// banned_phrase guardrail. 3 chars rules out the worst cases while
// still allowing useful short phrases like "tbh" or "lol".
export const MIN_BANNED_PHRASE_LEN = 3

// Phrase characters that would corrupt the system prompt if
// concatenated verbatim — newlines could open a new instruction
// section; quotes could escape the wrapping context.
const PROMPT_UNSAFE_CHARS = /[\n\r"]/

// Zod schema for incoming PATCH payloads. The DB column is jsonb with
// no constraints, so this is the only place we enforce shape.
//
// Schema is also reused on the READ path (readVoiceProfile uses
// safeParse and falls back to defaults). The strict rules here mean
// that pre-W7 data violating the new constraints will silently fall
// back to defaults on read — acceptable because W6 just shipped and
// no production data exists yet.
export const VoiceProfileSchema = z
  .object({
    tone_formal: z.number().int().min(0).max(100).optional(),
    tone_warm:   z.number().int().min(0).max(100).optional(),
    banned_phrases: z
      .array(
        z
          .string()
          .min(MIN_BANNED_PHRASE_LEN, `Banned phrases must be at least ${MIN_BANNED_PHRASE_LEN} characters.`)
          .max(MAX_BANNED_PHRASE_LEN)
          .refine(s => !PROMPT_UNSAFE_CHARS.test(s), 'Banned phrases cannot contain quotes or line breaks.'),
      )
      .max(MAX_BANNED_PHRASES)
      .optional(),
    custom_signoff: z
      .string()
      .max(MAX_SIGNOFF_LEN)
      .refine(s => !PROMPT_UNSAFE_CHARS.test(s), 'Sign-off cannot contain quotes or line breaks.')
      .nullable()
      .optional(),
  })
  .superRefine((data, ctx) => {
    // Sign-off must not contain any of the org's banned phrases —
    // otherwise the model is told to sign off with X AND told
    // never to say X, and every draft fails the banned_phrase
    // guardrail forever.
    if (!data.custom_signoff || !data.banned_phrases?.length) return
    const lower = data.custom_signoff.toLowerCase()
    for (const phrase of data.banned_phrases) {
      if (lower.includes(phrase.toLowerCase())) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['custom_signoff'],
          message: `Sign-off contains a banned phrase ("${phrase}"). Remove the phrase or change the sign-off.`,
        })
        return
      }
    }
  })

export type VoiceProfile = z.infer<typeof VoiceProfileSchema>

/**
 * Sanitize a raw jsonb read into a typed VoiceProfile with defaults
 * filled in. Tolerant of legacy/empty shapes — Phase 1 W4 created the
 * column with default '{}', so existing orgs read as all-defaults.
 */
export function readVoiceProfile(raw: unknown): Required<VoiceProfile> {
  const parsed = VoiceProfileSchema.safeParse(raw)
  const data = parsed.success ? parsed.data : {}
  return {
    tone_formal:    data.tone_formal    ?? DEFAULT_TONE_FORMAL,
    tone_warm:      data.tone_warm      ?? DEFAULT_TONE_WARM,
    banned_phrases: data.banned_phrases ?? [],
    custom_signoff: data.custom_signoff ?? null,
  }
}

/**
 * Build the system-prompt fragment that describes the org's voice.
 * Used by W7 when generateDraft() composes the system prompt. Kept
 * here in W6 so the shape is locked in alongside validation.
 *
 * Empty/default profile → returns empty string (no fragment added,
 * existing generic prompt holds).
 */
export function voiceProfileToPromptFragment(profile: Required<VoiceProfile>): string {
  const lines: string[] = []

  // Tone — only emit when the slider has CROSSED a quartile boundary.
  // Strict comparisons (<25 / >75) ensure that the all-defaults
  // profile (tone_formal=55, tone_warm=25) emits NOTHING — voice
  // settings are opt-in. The user has to actively pull the slider
  // past the boundary for a tone rule to appear.
  if (profile.tone_formal < 25) {
    lines.push('Tone: casual, like texting a friend. Use contractions.')
  } else if (profile.tone_formal > 75) {
    lines.push('Tone: formal. Use full sentences, no contractions.')
  }
  if (profile.tone_warm < 25) {
    lines.push('Warmth: very warm, personable, conversational.')
  } else if (profile.tone_warm > 75) {
    lines.push('Warmth: clinical and efficient, not chatty.')
  }

  if (profile.banned_phrases.length > 0) {
    lines.push(`NEVER use these phrases: ${profile.banned_phrases.map(p => `"${p}"`).join(', ')}.`)
  }

  if (profile.custom_signoff) {
    lines.push(`Sign off with: "${profile.custom_signoff}".`)
  }

  if (lines.length === 0) return ''
  return ['', '— Clinic voice rules —', ...lines].join('\n')
}
