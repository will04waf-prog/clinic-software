/**
 * Voice profile — per-org voice tuning for AI Twin drafts.
 *
 * Lives on organizations.ai_twin_voice_profile (jsonb column, default
 * '{}'). We chose jsonb over discrete columns so future Phase 2 work
 * (W7 few-shot wiring, W8 edit-pattern auto-tuning) can extend the
 * shape without per-field migrations.
 *
 * Phase 2 W6 stores it. Phase 2 W7 reads it into draft prompts. W6
 * code paths only touch the read/validate side — drafts are
 * unchanged this week.
 */

import { z } from 'zod'

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

// Zod schema for incoming PATCH payloads. The DB column is jsonb with
// no constraints, so this is the only place we enforce shape.
export const VoiceProfileSchema = z.object({
  tone_formal: z.number().int().min(0).max(100).optional(),
  tone_warm:   z.number().int().min(0).max(100).optional(),
  banned_phrases: z
    .array(z.string().min(1).max(MAX_BANNED_PHRASE_LEN))
    .max(MAX_BANNED_PHRASES)
    .optional(),
  custom_signoff: z.string().max(MAX_SIGNOFF_LEN).nullable().optional(),
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

  // Tone — only emit when the slider has moved off the midpoint band.
  // The thresholds avoid generating noisy prompt text for orgs that
  // accepted the defaults without thinking about it.
  if (profile.tone_formal <= 25) {
    lines.push('Tone: casual, like texting a friend. Use contractions.')
  } else if (profile.tone_formal >= 75) {
    lines.push('Tone: formal. Use full sentences, no contractions.')
  }
  if (profile.tone_warm <= 25) {
    lines.push('Warmth: very warm, personable, conversational.')
  } else if (profile.tone_warm >= 75) {
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
