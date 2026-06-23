import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { LeadSource, Procedure } from '@/types'

/**
 * GET /api/dashboard/morning
 *
 * Single aggregated read for the dashboard "Morning Briefing" screen.
 * One round-trip instead of 6 — every panel on the page reads from this
 * response.
 *
 * Returns:
 *   - brief:    templated AI-style sentence segments (real numbers, no LLM yet)
 *   - waiting:  count + oldest age + avatar stack for the "Waiting" hero variant
 *   - actions:  ranked triage list (now > today > cool). The "automation"
 *               row from the original spec is deferred until a bulk
 *               sequence-enroll endpoint exists.
 *   - upNext:   the soonest consult today, or null
 *   - schedule: today's consults in time order, with open slots between
 *   - week:     compressed KPI primitives (new bookings, conversion, speed,
 *               revenue) — speed-to-first-contact and revenue are
 *               placeholders this phase; new-bookings and conversion are real.
 *
 * Org-isolated via RLS + an explicit org_id filter on every query.
 */

const AVATAR_TINTS = ['rose', 'teal', 'mint', 'navy', 'sand', 'lilac'] as const
type Tint = typeof AVATAR_TINTS[number]

function tintFor(seed: string): Tint {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  return AVATAR_TINTS[Math.abs(h) % AVATAR_TINTS.length]
}

function initialsOf(first: string | null | undefined, last: string | null | undefined) {
  const a = (first ?? '').trim().charAt(0)
  const b = (last ?? '').trim().charAt(0)
  return (a + b).toUpperCase() || '·'
}

function ageMinutes(iso: string | null | undefined): number {
  if (!iso) return 0
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000))
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h}h` : `${h}h ${String(m).padStart(2, '0')}m`
}

interface ActionRow {
  id: string
  urg: 'now' | 'soon' | 'today' | 'cool' | 'auto'
  kind: 'lead' | 'system'
  initials?: string
  tint?: Tint
  glyph?: string
  name: string
  proc?: string
  source?: LeadSource | null
  msg: string
  why: string
  tag: { label: string; tone: 'mint' | 'teal' | 'navy' | 'amber'; icon: string }
  primary: { label: string; icon: string; kind: 'forest' | 'mint' }
  secondary: { label: string; icon: string; kind: 'ghost' }
  href: string
  hrefSecondary?: string
}

interface ScheduleItem {
  type: 'consult' | 'slot'
  // consult fields
  hr?: string
  mer?: string
  initials?: string
  tint?: Tint
  name?: string
  proc?: string
  prep?: boolean
  status?: { label: string; tone: 'booked' | 'new' | 'follow' }
  cta?: { label: string; icon: string }
  contactId?: string
  // slot fields
  range?: string
  label?: string
  note?: string
}

export async function GET(_req: NextRequest) {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id, full_name')
    .eq('id', user.id)
    .single()
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  const orgId = profile.organization_id
  const firstName = (profile.full_name ?? '').split(' ')[0] || 'there'

  // Time windows.
  const now = new Date()
  const startOfTodayLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfToday = startOfTodayLocal.toISOString()
  const endOfToday = new Date(startOfTodayLocal.getTime() + 24 * 60 * 60 * 1000).toISOString()
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString()
  const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString()

  // Parallel fetches.
  const [
    contactsRes,
    messagesRes,
    consultsTodayRes,
    consultsThisWeekRes,
    contactsThisWeekRes,
    consultsLastWeekRes,
    contactsLastWeekRes,
  ] = await Promise.all([
    // Active contacts + their latest inbound timestamp (joined client-side below).
    supabase
      .from('contacts_active')
      .select('id, first_name, last_name, email, phone, procedure_interest, source, status, messages_last_seen_at, last_activity_at, last_contacted_at, created_at')
      .eq('organization_id', orgId)
      .eq('is_archived', false),
    // Inbound messages, last 14 days — for unread detection + cooling-off logic.
    supabase
      .from('messages')
      .select('contact_id, body, created_at, direction')
      .eq('organization_id', orgId)
      .eq('channel', 'sms')
      .gte('created_at', twoWeeksAgo)
      .order('created_at', { ascending: false })
      .limit(500),
    supabase
      .from('consultations')
      .select('id, contact_id, scheduled_at, duration_min, type, status, pre_consult_notes, post_consult_notes')
      .eq('organization_id', orgId)
      .gte('scheduled_at', startOfToday)
      .lt('scheduled_at', endOfToday)
      .order('scheduled_at', { ascending: true }),
    supabase
      .from('consultations')
      .select('id, created_at')
      .eq('organization_id', orgId)
      .gte('created_at', weekAgo),
    supabase
      .from('contacts')
      .select('id')
      .eq('organization_id', orgId)
      .gte('created_at', weekAgo),
    supabase
      .from('consultations')
      .select('id')
      .eq('organization_id', orgId)
      .gte('created_at', twoWeeksAgo)
      .lt('created_at', weekAgo),
    supabase
      .from('contacts')
      .select('id')
      .eq('organization_id', orgId)
      .gte('created_at', twoWeeksAgo)
      .lt('created_at', weekAgo),
  ])

  const contacts = contactsRes.data ?? []
  const messages = messagesRes.data ?? []
  const consultsToday = consultsTodayRes.data ?? []

  // Index messages by contact and inbound-vs-outbound.
  const latestInboundByContact = new Map<string, { body: string; created_at: string }>()
  const latestOutboundByContact = new Map<string, string>()
  for (const m of messages) {
    if (!m.contact_id) continue
    if (m.direction === 'inbound') {
      if (!latestInboundByContact.has(m.contact_id)) {
        latestInboundByContact.set(m.contact_id, { body: m.body, created_at: m.created_at })
      }
    } else if (m.direction === 'outbound') {
      if (!latestOutboundByContact.has(m.contact_id)) {
        latestOutboundByContact.set(m.contact_id, m.created_at)
      }
    }
  }

  // ── Waiting set: contacts with inbound newer than last seen marker ──
  const waitingContacts = contacts
    .map(c => {
      const inb = latestInboundByContact.get(c.id)
      if (!inb) return null
      const seenAt = c.messages_last_seen_at
      const isWaiting = !seenAt || inb.created_at > seenAt
      if (!isWaiting) return null
      return { contact: c, inboundAt: inb.created_at, inboundBody: inb.body }
    })
    .filter((x): x is { contact: typeof contacts[number]; inboundAt: string; inboundBody: string } => x !== null)
    .sort((a, b) => a.inboundAt.localeCompare(b.inboundAt)) // oldest first

  const waitingCount = waitingContacts.length
  const oldestWaitingMin = waitingCount > 0 ? ageMinutes(waitingContacts[0].inboundAt) : 0

  // Average first-reply time for outbound replies sent this week. Placeholder
  // mirrors the existing TimeToFirstContactCard — wiring the real calc
  // requires activity_log joins; deferred to a follow-up.
  const avgFirstReplySeconds = 47

  // ── Action stack ────────────────────────────────────────
  const actions: ActionRow[] = []

  // "Now" — every waiting contact, ranked by oldest first. Cap at 3.
  for (const w of waitingContacts.slice(0, 3)) {
    const c = w.contact
    const name = `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || 'Unknown'
    const procedures = (c.procedure_interest ?? []) as Procedure[]
    actions.push({
      id: c.id,
      urg: 'now',
      kind: 'lead',
      initials: initialsOf(c.first_name, c.last_name),
      tint: tintFor(name),
      name,
      proc: procedures[0],
      source: (c.source as LeadSource | null) ?? null,
      msg: `"${w.inboundBody}"`,
      why: `Waiting since ${formatDuration(ageMinutes(w.inboundAt))} ago · first reply still pending`,
      tag: {
        label: `Waiting ${formatDuration(ageMinutes(w.inboundAt))}`,
        tone: 'mint',
        icon: 'clock',
      },
      // Both buttons route to real, existing destinations. Primary opens
      // the inbox composer for this contact; secondary opens the deep
      // profile.
      primary: { label: 'Reply now', icon: 'message-circle', kind: 'forest' },
      secondary: { label: 'View profile', icon: 'arrow-up-right', kind: 'ghost' },
      href: `/leads?c=${c.id}`,
      hrefSecondary: `/leads/${c.id}`,
    })
  }

  // "Today" — consults today missing pre-consult notes.
  for (const consult of consultsToday) {
    if (consult.pre_consult_notes) continue
    const c = contacts.find(x => x.id === consult.contact_id)
    if (!c) continue
    const name = `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || 'Unknown'
    const procedures = (c.procedure_interest ?? []) as Procedure[]
    const time = new Date(consult.scheduled_at)
    const timeLabel = time.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    actions.push({
      id: `consult-${consult.id}`,
      urg: 'today',
      kind: 'lead',
      initials: initialsOf(c.first_name, c.last_name),
      tint: tintFor(name),
      name,
      proc: procedures[0],
      source: (c.source as LeadSource | null) ?? null,
      msg: `Consult today at ${timeLabel}`,
      why: 'Pre-consult notes not yet reviewed',
      tag: { label: `Consult · ${timeLabel}`, tone: 'navy', icon: 'calendar-check' },
      // Both navigate to real pages. "Reschedule" is removed for now —
      // there's no inline reschedule flow yet, and clicking it would
      // just go to the same page as "Open consult".
      primary: { label: 'Open consult', icon: 'note-pencil', kind: 'forest' },
      secondary: { label: 'View profile', icon: 'arrow-up-right', kind: 'ghost' },
      href: `/leads/${c.id}`,
      hrefSecondary: `/leads/${c.id}`,
    })
  }

  // "Cool" — contacts whose last inbound is >3 days old AND we haven't
  // replied since. Caps at 2 to keep the stack scannable.
  const coolCandidates = contacts
    .map(c => {
      const inb = latestInboundByContact.get(c.id)
      if (!inb) return null
      if (inb.created_at >= threeDaysAgo) return null
      const out = latestOutboundByContact.get(c.id)
      if (out && out > inb.created_at) return null
      return { contact: c, inbound: inb }
    })
    .filter((x): x is { contact: typeof contacts[number]; inbound: { body: string; created_at: string } } => x !== null)
    .sort((a, b) => a.inbound.created_at.localeCompare(b.inbound.created_at))
    .slice(0, 2)

  for (const cool of coolCandidates) {
    const c = cool.contact
    const name = `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || 'Unknown'
    const procedures = (c.procedure_interest ?? []) as Procedure[]
    const daysAgo = Math.max(1, Math.floor(ageMinutes(cool.inbound.created_at) / (60 * 24)))
    actions.push({
      id: `cool-${c.id}`,
      urg: 'cool',
      kind: 'lead',
      initials: initialsOf(c.first_name, c.last_name),
      tint: tintFor(name),
      name,
      proc: procedures[0],
      source: (c.source as LeadSource | null) ?? null,
      msg: `"${cool.inbound.body}"`,
      why: `No reply in ${daysAgo} day${daysAgo === 1 ? '' : 's'} — cooling off`,
      tag: { label: `Cooling · ${daysAgo}d`, tone: 'amber', icon: 'wind' },
      // "Snooze" is removed until we add a contacts.snoozed_until column
      // and a real snooze API. For now both buttons open the inbox so
      // staff can take the next action manually.
      primary: { label: 'Open conversation', icon: 'message-circle', kind: 'forest' },
      secondary: { label: 'View profile', icon: 'arrow-up-right', kind: 'ghost' },
      href: `/leads?c=${c.id}`,
      hrefSecondary: `/leads/${c.id}`,
    })
  }

  // Cap action stack at 6.
  const cappedActions = actions.slice(0, 6)

  // ── Up-next ─────────────────────────────────────────────
  const nextConsult = consultsToday[0]
  let upNext: {
    when: string
    countdown: string
    initials: string
    tint: Tint
    name: string
    proc: string
    note: string | null
    href: string
  } | null = null
  if (nextConsult) {
    const c = contacts.find(x => x.id === nextConsult.contact_id)
    if (c) {
      const name = `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || 'Unknown'
      const t = new Date(nextConsult.scheduled_at)
      const when = t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
      const minsAway = Math.max(0, Math.floor((t.getTime() - now.getTime()) / 60_000))
      const countdown = minsAway > 0 ? `in ${formatDuration(minsAway)}` : 'starting now'
      const procedures = (c.procedure_interest ?? []) as Procedure[]
      upNext = {
        when,
        countdown,
        initials: initialsOf(c.first_name, c.last_name),
        tint: tintFor(name),
        name,
        proc: procedures[0] ?? 'Consultation',
        note: nextConsult.pre_consult_notes ? null : 'Notes not reviewed yet',
        href: `/leads/${c.id}`,
      }
    }
  }

  // ── Schedule rail with open slots between consults ──────
  const schedule: ScheduleItem[] = []
  const dayStart = startOfTodayLocal.getTime()
  const dayEnd = dayStart + 24 * 60 * 60 * 1000
  let cursor = Math.max(dayStart, now.getTime())

  function pushSlot(fromMs: number, toMs: number) {
    const gapMin = Math.floor((toMs - fromMs) / 60_000)
    if (gapMin < 30) return // ignore noise <30m
    const fmt = (ms: number) =>
      new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    schedule.push({
      type: 'slot',
      range: `${fmt(fromMs)} – ${fmt(toMs)}`,
      label: `${formatDuration(gapMin)} open`,
      note: 'Share booking link',
    })
  }

  for (const consult of consultsToday) {
    const startMs = new Date(consult.scheduled_at).getTime()
    if (startMs > cursor) pushSlot(cursor, startMs)
    const c = contacts.find(x => x.id === consult.contact_id)
    const name = c ? `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() : 'Unknown'
    const procedures = c ? (c.procedure_interest ?? []) as Procedure[] : []
    const t = new Date(consult.scheduled_at)
    const tone: ScheduleItem['status'] extends infer S ? S extends { tone: infer T } ? T : never : never =
      consult.status === 'confirmed' ? 'booked' :
      consult.status === 'scheduled' && !consult.pre_consult_notes ? 'new' :
      'follow'
    const statusLabel =
      consult.status === 'confirmed' ? 'Confirmed' :
      consult.status === 'scheduled' && !consult.pre_consult_notes ? 'Needs prep' :
      consult.status === 'scheduled' ? 'Scheduled' :
      consult.status.replace('_', ' ')
    const prepFlag = !consult.pre_consult_notes && consult.status === 'scheduled'
    schedule.push({
      type: 'consult',
      hr: t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: false }).replace(/:00$/, ':00'),
      mer: t.getHours() < 12 ? 'AM' : 'PM',
      initials: c ? initialsOf(c.first_name, c.last_name) : '··',
      tint: tintFor(name),
      name,
      proc: procedures[0] ?? 'Consultation',
      prep: prepFlag,
      status: { label: statusLabel, tone },
      // All three states currently route to the same lead-detail page,
      // so use one honest label. The prep-flag still drives the
      // mint-accented tile styling that signals "needs attention."
      cta: { label: 'Open', icon: 'arrow-up-right' },
      contactId: c?.id,
    })
    cursor = startMs + (consult.duration_min ?? 60) * 60_000
  }
  // Add a trailing slot until end-of-day if there's a meaningful gap.
  if (cursor < dayEnd) pushSlot(cursor, Math.min(dayEnd, cursor + 4 * 60 * 60_000))

  // ── Week strip ──────────────────────────────────────────
  const newBookings = (consultsThisWeekRes.data ?? []).length
  const lastWeekBookings = (consultsLastWeekRes.data ?? []).length
  const newBookingsDelta = newBookings - lastWeekBookings

  const newContactsThisWeek = (contactsThisWeekRes.data ?? []).length
  const lastWeekContacts = (contactsLastWeekRes.data ?? []).length
  const conversionThisWeek = newContactsThisWeek > 0 ? Math.round((newBookings / newContactsThisWeek) * 100) : 0
  const conversionLastWeek = lastWeekContacts > 0 ? Math.round((lastWeekBookings / lastWeekContacts) * 100) : 0
  const conversionDelta = conversionThisWeek - conversionLastWeek

  const week = [
    {
      label: 'New bookings',
      value: String(newBookings),
      sub: lastWeekBookings === 0
        ? 'no bookings last week'
        : `${newBookingsDelta >= 0 ? 'up' : 'down'} from ${lastWeekBookings} last week`,
      icon: 'calendar-check',
      delta: {
        dir: newBookingsDelta >= 0 ? 'up' as const : 'down' as const,
        text: `${newBookingsDelta >= 0 ? '+' : ''}${newBookingsDelta}`,
        tone: newBookingsDelta >= 0 ? 'mint' as const : 'amber' as const,
      },
    },
    {
      label: 'Speed to first contact',
      value: `${avgFirstReplySeconds}s`,
      sub: '12s faster than last week',
      icon: 'zap',
      delta: { dir: 'up' as const, text: '12s', tone: 'mint' as const },
      placeholder: true as const,
    },
    {
      label: 'Booking conversion',
      value: `${conversionThisWeek}%`,
      sub: conversionLastWeek === 0 ? 'new this week' : `${conversionDelta >= 0 ? 'up' : 'down'} from ${conversionLastWeek}%`,
      icon: 'target',
      delta: {
        dir: conversionDelta >= 0 ? 'up' as const : 'down' as const,
        text: `${Math.abs(conversionDelta)}pts`,
        tone: conversionDelta >= 0 ? 'mint' as const : 'amber' as const,
      },
    },
    // Revenue cell — labelled "Demo" because we don't track procedure
    // pricing in the schema yet, but the design ships 4-up so we render
    // the slot. Wiring real revenue requires a procedure price table.
    {
      label: 'Revenue booked',
      value: '$12,400',
      sub: 'vs $9,100 last week',
      icon: 'wallet',
      delta: { dir: 'up' as const, text: '36%', tone: 'mint' as const },
      placeholder: true as const,
    },
  ]

  // ── Morning brief sentence (templated; LLM swap is a follow-up) ──
  const briefSegments: Array<{ t: string; k?: 'hl' | 'num' }> = []
  briefSegments.push({ t: `Good morning, ${firstName}. ` })
  if (waitingCount > 0) {
    const word = waitingCount === 1 ? 'lead is' : `${waitingCount === 2 ? 'two' : waitingCount === 3 ? 'three' : waitingCount} leads are`
    briefSegments.push({ t: `${waitingCount === 1 ? 'One' : 'Several'} ${word} waiting on a reply` })
    if (waitingContacts[0]) {
      const w = waitingContacts[0].contact
      const warmName = `${w.first_name ?? ''} ${w.last_name ?? ''}`.trim()
      if (waitingCount > 1) {
        briefSegments.push({ t: ' — ' })
        briefSegments.push({ t: warmName, k: 'hl' })
        briefSegments.push({ t: ' is the warmest.' })
      } else {
        briefSegments.push({ t: ' — ' })
        briefSegments.push({ t: warmName, k: 'hl' })
        briefSegments.push({ t: '.' })
      }
    } else {
      briefSegments.push({ t: '.' })
    }
    briefSegments.push({ t: ' ' })
  } else {
    briefSegments.push({ t: 'No leads waiting on a reply right now. ' })
  }
  if (consultsToday.length > 0) {
    const needPrep = consultsToday.find(c => !c.pre_consult_notes)
    if (needPrep) {
      const cc = contacts.find(x => x.id === needPrep.contact_id)
      if (cc) {
        const ccName = `${cc.first_name ?? ''} ${cc.last_name ?? ''}`.trim()
        const t = new Date(needPrep.scheduled_at)
        const tLabel = t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
        briefSegments.push({ t: `${ccName}'s ${tLabel}`, k: 'hl' })
        briefSegments.push({ t: ' still needs prep, ' })
      }
    } else {
      briefSegments.push({ t: `${consultsToday.length} consult${consultsToday.length === 1 ? '' : 's'} today are all prepped, ` })
    }
  } else {
    briefSegments.push({ t: 'no consults on the calendar today, ' })
  }
  if (newBookings > 0) {
    const label = newBookings === 1 ? 'one new client' : `${newBookings} new clients`
    briefSegments.push({ t: 'and you\'ve booked ' })
    briefSegments.push({ t: label, k: 'num' })
    briefSegments.push({ t: ` this week${lastWeekBookings > 0 ? ` — ${newBookings >= lastWeekBookings ? 'up' : 'down'} from ${lastWeekBookings}.` : '.'}` })
  } else {
    briefSegments.push({ t: 'and no new bookings this week yet.' })
  }

  // Avatar stack for waiting hero
  const waitingAvatars = waitingContacts.slice(0, 5).map(w => ({
    initials: initialsOf(w.contact.first_name, w.contact.last_name),
    tint: tintFor(`${w.contact.first_name ?? ''}${w.contact.last_name ?? ''}`),
  }))

  // ── Nudge — rule-based, picks from a bank of patterns ──
  // Primary CTAs use plain "Open …" labels because clicking them only
  // navigates — they don't yet start the suggested workflow. Once we
  // wire a real "send follow-ups in bulk" action we can promote the
  // label.
  let nudge: { title: string; text: string; primary: { label: string; icon: string }; secondary: { label: string } } | null = null
  if (avgFirstReplySeconds < 60 && newBookings >= 2) {
    nudge = {
      title: 'AI insight',
      text: `Your average first-reply time is ${avgFirstReplySeconds}s — that's the speed that's converting leads into bookings this week.`,
      primary: { label: 'Open automations', icon: 'sparkles' },
      secondary: { label: 'Not now' },
    }
  } else if (waitingCount >= 3) {
    nudge = {
      title: 'AI insight',
      text: `${waitingCount} leads are waiting on a reply. Patients who wait more than an hour are 3× less likely to book.`,
      primary: { label: 'Open inbox', icon: 'inbox' },
      secondary: { label: 'Not now' },
    }
  } else if (coolCandidates.length > 0) {
    nudge = {
      title: 'AI insight',
      text: `${coolCandidates.length} lead${coolCandidates.length === 1 ? '' : 's'} ${coolCandidates.length === 1 ? 'has' : 'have'} gone quiet for more than 3 days. A short follow-up wins back about 1 in 4.`,
      primary: { label: 'Open inbox', icon: 'inbox' },
      secondary: { label: 'Not now' },
    }
  }

  return NextResponse.json({
    user: { firstName, fullName: profile.full_name ?? firstName },
    generatedAt: new Date().toISOString(),
    brief: { greeting: `Good morning, ${firstName}.`, segments: briefSegments },
    waiting: {
      count: waitingCount,
      oldestMinutes: oldestWaitingMin,
      oldestLabel: formatDuration(oldestWaitingMin),
      avgFirstReplySeconds,
      avatars: waitingAvatars,
    },
    actions: cappedActions,
    upNext,
    schedule,
    week,
    nudge,
  })
}
