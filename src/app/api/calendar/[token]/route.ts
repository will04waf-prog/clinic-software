/**
 * GET /api/calendar/[token] — the org's jobs as a subscribable ICS feed.
 *
 * WS-D #3 pick: solo operators live in Google/Apple Calendar; this puts
 * their Tarhunna jobs there with zero OAuth. The token is a 'calendar_feed'
 * capability token signing the ORG id — unguessable, revocable by rotating
 * MANAGE_TOKEN_SECRET, read-only by construction. The proxy matcher
 * excludes /api, so possession of a valid token is the entire auth.
 *
 * Jobs are DATE-only (no time-of-day column), so events are all-day.
 * Canceled jobs export STATUS:CANCELLED so calendars grey them out.
 * Window: 30 days back / 400 days forward (recurring chains spawn one
 * occurrence at a time, so "forward" is naturally short).
 *
 * Known limitation (documented in the settings card): Google refreshes
 * subscribed ICS feeds on its own schedule (hours). Apple Calendar
 * lets the user choose (down to ~5 min). True near-real-time needs the
 * GCal API push — gated on founder GCP verification, tracked as a
 * follow-up.
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { verifyCapabilityToken } from '@/lib/tokens/capability-token'

/** RFC 5545 TEXT escaping: backslash, semicolon, comma, newline. */
function icsEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

const dateBasic = (iso: string) => iso.replaceAll('-', '')

function nextDay(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  const orgId = verifyCapabilityToken('calendar_feed', token)
  if (!orgId) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('name, owner_language')
    .eq('id', orgId)
    .maybeSingle()
  if (!org) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const es = org.owner_language !== 'en'

  const today = new Date()
  const from = new Date(today.getTime() - 30 * 86_400_000).toISOString().slice(0, 10)
  const to = new Date(today.getTime() + 400 * 86_400_000).toISOString().slice(0, 10)

  const { data: jobs, error } = await supabaseAdmin
    .from('jobs')
    .select('id, title, scheduled_date, status, updated_at, contact:contacts(first_name, last_name)')
    .eq('organization_id', orgId)
    .gte('scheduled_date', from)
    .lte('scheduled_date', to)
    .order('scheduled_date', { ascending: true })
    .limit(1000)
  if (error) {
    console.error('[calendar-feed] query failed:', error.message)
    return NextResponse.json({ error: 'feed_unavailable' }, { status: 503 })
  }

  const calName = es ? `Trabajos — ${org.name}` : `Jobs — ${org.name}`
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Tarhunna//Jobs Feed//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsEscape(calName)}`,
    'X-WR-TIMEZONE:America/New_York',
  ]

  for (const j of jobs ?? []) {
    if (!j.scheduled_date) continue
    const c = Array.isArray(j.contact) ? j.contact[0] : j.contact
    const client = [c?.first_name, c?.last_name].filter(Boolean).join(' ')
    const title = j.title || (es ? 'Trabajo' : 'Job')
    const summary = client ? `${title} — ${client}` : title
    const stamp = (j.updated_at ?? new Date().toISOString()).replace(/[-:]/g, '').replace(/\.\d+/, '')
    lines.push(
      'BEGIN:VEVENT',
      `UID:job-${j.id}@tarhunna.net`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${dateBasic(j.scheduled_date)}`,
      `DTEND;VALUE=DATE:${dateBasic(nextDay(j.scheduled_date))}`,
      `SUMMARY:${icsEscape(summary)}`,
      ...(j.status === 'canceled' ? ['STATUS:CANCELLED'] : []),
      ...(j.status === 'completed' ? [`DESCRIPTION:${icsEscape(es ? 'Completado ✓' : 'Completed ✓')}`] : []),
      'END:VEVENT',
    )
  }
  lines.push('END:VCALENDAR')

  // RFC 5545 says CRLF line endings.
  return new NextResponse(lines.join('\r\n') + '\r\n', {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="tarhunna-jobs.ics"',
      // Feed readers poll; let them cache briefly.
      'Cache-Control': 'private, max-age=300',
    },
  })
}
