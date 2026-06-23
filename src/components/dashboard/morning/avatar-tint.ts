/**
 * Warm avatar tints used across the morning-briefing dashboard.
 * Matches the inbox's ContactAvatar palette so a contact shows the
 * same color everywhere they appear in the app.
 *
 * Server picks the tint name (rose, teal, mint, navy, sand, lilac)
 * deterministically per contact name; this map is the single source
 * of truth for the bg + fg colors.
 */

export type AvatarTint = 'rose' | 'teal' | 'mint' | 'navy' | 'sand' | 'lilac'

export const AVATAR_TINT_COLORS: Record<AvatarTint, { bg: string; fg: string }> = {
  rose:  { bg: '#F4E2DB', fg: '#B45F47' },
  teal:  { bg: '#D6EBEC', fg: '#036B78' },
  mint:  { bg: '#D4F1E8', fg: '#058B6F' },
  navy:  { bg: '#DBE3E5', fg: '#0B2027' },
  sand:  { bg: '#F0E8D3', fg: '#93792F' },
  lilac: { bg: '#E7E2EF', fg: '#6C5E8C' },
}
