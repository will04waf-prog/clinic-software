import { NextResponse } from 'next/server'
import { z } from 'zod'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
import { formatProcedure } from '@/lib/utils'

const BodySchema = z.object({
  channel: z.enum(['sms', 'email']),
})

const RATE_LIMIT_PER_HOUR = 20

export async function POST(
  request: Request,
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

  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const parsed = BodySchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }
  const { channel } = parsed.data

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: 'ai_not_configured', message: 'AI drafting is not configured for this environment.' },
      { status: 503 },
    )
  }

  // Org-scoped contact fetch (explicit, belt + suspenders with RLS).
  const { data: contact } = await supabase
    .from('contacts_active')
    .select('id, first_name, procedure_interest, source, status, created_at, last_contacted_at, organization_id')
    .eq('id', contactId)
    .eq('organization_id', orgId)
    .single()

  if (!contact) return NextResponse.json({ error: 'Contact not found' }, { status: 404 })

  // Rate limit: count ai_draft_generated entries in the last hour for this org.
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const { count: recentDraftCount } = await supabase
    .from('activity_log')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .eq('action', 'ai_draft_generated')
    .gte('created_at', oneHourAgo)

  if ((recentDraftCount ?? 0) >= RATE_LIMIT_PER_HOUR) {
    return NextResponse.json(
      {
        error: 'rate_limited',
        message: `You've hit the limit of ${RATE_LIMIT_PER_HOUR} AI drafts per hour. Try again later.`,
      },
      { status: 429 },
    )
  }

  // Recent message history (last 5, newest first), org-scoped.
  const { data: recentMessages } = await supabase
    .from('messages')
    .select('channel, direction, body, sent_at, created_at')
    .eq('contact_id', contactId)
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
    .limit(5)

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
      const preview = (m.body ?? '').slice(0, 120).replace(/\s+/g, ' ')
      return `- ${dir} (${ch}): "${preview}${(m.body ?? '').length > 120 ? '…' : ''}"`
    })
    .join('\n')

  const systemPrompt = channel === 'sms'
    ? SMS_SYSTEM_PROMPT
    : EMAIL_SYSTEM_PROMPT

  const userPrompt = buildUserPrompt({
    firstName: contact.first_name,
    clinicName: org?.name ?? 'our clinic',
    procedures,
    source: contact.source as string | null,
    status: contact.status as string | null,
    daysSinceCreated,
    daysSinceLastContact,
    messageSummary,
  })

  const client = new Anthropic()

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 300,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    })

    const textBlock = response.content.find(b => b.type === 'text')
    const rawText = textBlock && textBlock.type === 'text' ? textBlock.text.trim() : ''

    if (!rawText) {
      return NextResponse.json(
        { error: 'empty_response', message: "Couldn't generate draft — try again." },
        { status: 502 },
      )
    }

    // Log the draft event for rate-limiting. Body content is NOT stored —
    // drafts are not sends, and we don't want them in user-visible message history.
    await supabase.from('activity_log').insert({
      organization_id: orgId,
      contact_id:      contactId,
      action:          'ai_draft_generated',
      metadata: {
        channel,
        model: 'claude-haiku-4-5',
      },
    })

    if (channel === 'email') {
      const { subject, body } = splitEmailDraft(rawText)
      return NextResponse.json({ subject, draft: body })
    }

    return NextResponse.json({ draft: rawText })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'AI draft failed'
    return NextResponse.json(
      { error: 'draft_failed', message: "Couldn't generate draft — try again.", detail: message },
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
  clinicName: string
  procedures: string[]
  source: string | null
  status: string | null
  daysSinceCreated: number
  daysSinceLastContact: number | null
  messageSummary: string
}

function buildUserPrompt(v: PromptVars): string {
  const lines: string[] = []
  lines.push(`Contact first name: ${v.firstName}`)
  lines.push(`Procedure interest: ${v.procedures.length > 0 ? v.procedures.join(', ') : 'unspecified'}`)
  lines.push(`Lead source: ${v.source ?? 'unknown'}`)
  lines.push(`Lead status: ${v.status ?? 'lead'}`)
  lines.push(`Days since lead created: ${v.daysSinceCreated}`)
  lines.push(
    v.daysSinceLastContact !== null
      ? `Days since last contacted: ${v.daysSinceLastContact}`
      : `Last contacted: never`,
  )
  lines.push(`Clinic name: ${v.clinicName}`)
  if (v.messageSummary) {
    lines.push(``)
    lines.push(`Recent message history (oldest first):`)
    lines.push(v.messageSummary)
  }
  lines.push(``)
  lines.push(`Write the follow-up message now. Output ONLY the message text, no preamble or commentary.`)
  return lines.join('\n')
}

const SMS_SYSTEM_PROMPT = `You write warm, professional follow-up SMS messages from a med spa or aesthetic clinic to a prospective patient.

Hard rules:
- Maximum 160 characters total.
- No emojis.
- No pushy sales language ("act now", "limited time", "don't miss out").
- Reference the contact's procedure interest naturally if one is provided.
- Include a soft call to action — offer to book a consultation or answer questions.
- Never invent medical claims, before/after results, specific outcomes, pricing, discounts, or promotions.
- Never claim a procedure is "right for them" or guarantee results.
- Address the contact by first name.
- Sign off as the clinic name.

Output ONLY the SMS body text. No preamble, no quotes, no labels.`

const EMAIL_SYSTEM_PROMPT = `You write warm, professional follow-up emails from a med spa or aesthetic clinic to a prospective patient.

Hard rules:
- First line is exactly: Subject: <subject line here>
- Then a blank line, then the email body.
- Email body is 3-4 short sentences, plain text only.
- No emojis.
- No pushy sales language.
- Reference the contact's procedure interest naturally if one is provided.
- Include a soft call to action — offer to book a consultation or answer questions.
- Never invent medical claims, before/after results, specific outcomes, pricing, discounts, or promotions.
- Never claim a procedure is "right for them" or guarantee results.
- Address the contact by first name.
- Sign off using the clinic name.

Output ONLY the email in the format described. No preamble, no quotes, no commentary.`

function splitEmailDraft(raw: string): { subject: string; body: string } {
  // Model is instructed to emit "Subject: ..." then blank line then body.
  const lines = raw.split('\n')
  const firstLine = lines[0]?.trim() ?? ''
  const subjectMatch = firstLine.match(/^subject\s*:\s*(.+)$/i)

  if (subjectMatch) {
    const subject = subjectMatch[1].trim()
    const body = lines.slice(1).join('\n').replace(/^\s+/, '').trim()
    return { subject, body }
  }

  // Fallback: no Subject prefix — return the whole thing as body, leave subject empty.
  return { subject: '', body: raw }
}
