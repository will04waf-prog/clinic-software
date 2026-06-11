import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
import { formatProcedure } from '@/lib/utils'

const RATE_LIMIT_PER_HOUR = 30

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: contactId } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id, organization:organizations(id, name)')
    .eq('id', user.id)
    .single()

  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const orgId = profile.organization_id
  const org   = profile.organization as any

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: 'ai_not_configured', message: 'AI summarization is not configured for this environment.' },
      { status: 503 },
    )
  }

  // Org-scoped contact fetch (explicit, belt + suspenders with RLS).
  const { data: contact } = await supabase
    .from('contacts_active')
    .select('id, first_name, last_name, procedure_interest, source, status, created_at, last_contacted_at, organization_id, stage:pipeline_stages(name)')
    .eq('id', contactId)
    .eq('organization_id', orgId)
    .single()

  if (!contact) return NextResponse.json({ error: 'Contact not found' }, { status: 404 })

  // Rate limit: count ai_summary_generated entries in the last hour for this org.
  // Separate counter from ai_draft_generated — summaries and drafts have
  // different costs and use patterns, so they don't share a budget.
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const { count: recentCount } = await supabase
    .from('activity_log')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .eq('action', 'ai_summary_generated')
    .gte('created_at', oneHourAgo)

  if ((recentCount ?? 0) >= RATE_LIMIT_PER_HOUR) {
    return NextResponse.json(
      {
        error: 'rate_limited',
        message: `You've hit the limit of ${RATE_LIMIT_PER_HOUR} AI summaries per hour. Try again later.`,
      },
      { status: 429 },
    )
  }

  // Last 10 messages, org-scoped, newest first (we reverse for the prompt).
  const { data: recentMessages } = await supabase
    .from('messages')
    .select('channel, direction, body, sent_at, created_at')
    .eq('contact_id', contactId)
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
    .limit(10)

  // Consultations for this contact, org-scoped, newest first.
  const { data: consultations } = await supabase
    .from('consultations')
    .select('scheduled_at, status, type, procedure_discussed')
    .eq('contact_id', contactId)
    .eq('organization_id', orgId)
    .order('scheduled_at', { ascending: false })

  const procedures = (contact.procedure_interest as string[] | null ?? [])
    .map(formatProcedure)
    .filter(Boolean)

  const daysSinceCreated = daysSince(contact.created_at as string)
  const daysSinceLastContact = contact.last_contacted_at
    ? daysSince(contact.last_contacted_at as string)
    : null

  const messageSummary = (recentMessages ?? [])
    .reverse()
    .map(m => {
      const dir = m.direction === 'outbound' ? 'We sent' : 'They sent'
      const ch  = m.channel === 'sms' ? 'SMS' : 'email'
      const preview = (m.body ?? '').slice(0, 140).replace(/\s+/g, ' ')
      return `- ${dir} (${ch}): "${preview}${(m.body ?? '').length > 140 ? '…' : ''}"`
    })
    .join('\n')

  const consultationSummary = (consultations ?? [])
    .map(c => {
      const when = new Date(c.scheduled_at as string).toISOString().slice(0, 10)
      const procs = ((c.procedure_discussed as string[] | null) ?? [])
        .map(formatProcedure)
        .filter(Boolean)
        .join(', ')
      const procPart = procs ? ` for ${procs}` : ''
      return `- ${when}: ${c.status}${procPart} (${c.type})`
    })
    .join('\n')

  const stageName = (contact.stage as any)?.name as string | undefined

  const userPrompt = buildUserPrompt({
    firstName:            contact.first_name,
    lastName:             contact.last_name as string | null,
    clinicName:           org?.name ?? 'the clinic',
    procedures,
    source:               contact.source as string | null,
    status:               contact.status as string | null,
    stage:                stageName ?? null,
    daysSinceCreated,
    daysSinceLastContact,
    messageSummary,
    consultationSummary,
    consultationCount:    (consultations ?? []).length,
  })

  const client = new Anthropic()

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 200,
      system: SUMMARY_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    })

    const textBlock = response.content.find(b => b.type === 'text')
    const summary = textBlock && textBlock.type === 'text' ? textBlock.text.trim() : ''

    if (!summary) {
      return NextResponse.json(
        { error: 'empty_response', message: "Couldn't generate summary — try again." },
        { status: 502 },
      )
    }

    // Log the event for rate-limiting. Summary text is NOT stored —
    // summaries are on-demand and not part of contact history.
    await supabase.from('activity_log').insert({
      organization_id: orgId,
      contact_id:      contactId,
      action:          'ai_summary_generated',
      metadata: {
        model: 'claude-haiku-4-5',
      },
    })

    return NextResponse.json({ summary })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'AI summary failed'
    return NextResponse.json(
      { error: 'summary_failed', message: "Couldn't generate summary — try again.", detail: message },
      { status: 502 },
    )
  }
}

function daysSince(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime()
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)))
}

interface PromptVars {
  firstName: string
  lastName: string | null
  clinicName: string
  procedures: string[]
  source: string | null
  status: string | null
  stage: string | null
  daysSinceCreated: number
  daysSinceLastContact: number | null
  messageSummary: string
  consultationSummary: string
  consultationCount: number
}

function buildUserPrompt(v: PromptVars): string {
  const lines: string[] = []
  const fullName = v.lastName ? `${v.firstName} ${v.lastName}` : v.firstName
  lines.push(`Contact name: ${fullName}`)
  lines.push(`Procedure interest: ${v.procedures.length > 0 ? v.procedures.join(', ') : 'unspecified'}`)
  lines.push(`Lead source: ${v.source ?? 'unknown'}`)
  lines.push(`Lead status: ${v.status ?? 'lead'}`)
  lines.push(`Pipeline stage: ${v.stage ?? 'unassigned'}`)
  lines.push(`Days since lead created: ${v.daysSinceCreated}`)
  lines.push(
    v.daysSinceLastContact !== null
      ? `Days since last contacted: ${v.daysSinceLastContact}`
      : `Last contacted: never`,
  )
  lines.push(`Total consultations on record: ${v.consultationCount}`)
  lines.push(`Clinic name: ${v.clinicName}`)

  if (v.messageSummary) {
    lines.push(``)
    lines.push(`Recent message history (oldest first):`)
    lines.push(v.messageSummary)
  }

  if (v.consultationSummary) {
    lines.push(``)
    lines.push(`Consultations (newest first):`)
    lines.push(v.consultationSummary)
  }

  lines.push(``)
  lines.push(`Write the summary now.`)
  return lines.join('\n')
}

const SUMMARY_SYSTEM_PROMPT = `Summarize this lead's status for a busy clinic owner in 1-2 sentences. State the facts: what they're interested in, how they came in, how long ago, contact history, and current stage. End with ONE concrete suggested next action. Be concise and factual. NEVER invent information not present in the data — if data is missing, don't speculate. No greetings, no preamble, output only the summary.`
