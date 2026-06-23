/**
 * Shared types for the morning-briefing dashboard. These mirror the
 * exact shape returned by /api/dashboard/morning so the page can be
 * fully typed without re-declaring response shapes per component.
 */
import type { LeadSource } from '@/types'
import type { AvatarTint } from './avatar-tint'

export type Urgency = 'now' | 'soon' | 'today' | 'cool' | 'auto'
export type TagTone = 'mint' | 'teal' | 'navy' | 'amber'

export interface ActionRow {
  id: string
  urg: Urgency
  kind: 'lead' | 'system'
  initials?: string
  tint?: AvatarTint
  glyph?: string
  name: string
  proc?: string
  source?: LeadSource | null
  msg: string
  why: string
  tag: { label: string; tone: TagTone; icon: string }
  primary: { label: string; icon: string; kind: 'forest' | 'mint' }
  secondary: { label: string; icon: string; kind: 'ghost' }
  href: string
  // Secondary CTAs route to the deep profile by default; falls back to
  // `href` if a row doesn't differentiate.
  hrefSecondary?: string
}

export interface ScheduleConsult {
  type: 'consult'
  hr: string
  mer: string
  initials: string
  tint: AvatarTint
  name: string
  proc: string
  prep?: boolean
  status: { label: string; tone: 'booked' | 'new' | 'follow' }
  cta: { label: string; icon: string }
  contactId?: string
}
export interface ScheduleSlot {
  type: 'slot'
  range: string
  label: string
  note: string
}
export type ScheduleItem = ScheduleConsult | ScheduleSlot

export interface WeekPrimitive {
  label: string
  value: string
  sub: string
  icon: string
  delta: { dir: 'up' | 'down'; text: string; tone: 'mint' | 'amber' }
  placeholder?: boolean
}

export interface MorningBriefSegment {
  t: string
  k?: 'hl' | 'num'
}

export interface UpNextCardData {
  when: string
  countdown: string
  initials: string
  tint: AvatarTint
  name: string
  proc: string
  note: string | null
  href: string
}

export interface NudgeCardData {
  title: string
  text: string
  primary: { label: string; icon: string }
  secondary: { label: string }
}

export interface MorningResponse {
  user: { firstName: string; fullName: string }
  generatedAt: string
  brief: { greeting: string; segments: MorningBriefSegment[] }
  waiting: {
    count: number
    oldestMinutes: number
    oldestLabel: string
    avgFirstReplySeconds: number
    avatars: { initials: string; tint: AvatarTint }[]
  }
  actions: ActionRow[]
  upNext: UpNextCardData | null
  schedule: ScheduleItem[]
  week: WeekPrimitive[]
  nudge: NudgeCardData | null
}
