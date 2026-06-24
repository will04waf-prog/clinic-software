import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { generateDraft, type DraftContext } from '@/lib/ai-twin'

/**
 * POST /api/leads/[id]/draft-message — manual "AI Draft" button on
 * the lead detail page. Pre-W7 this route inlined its own Anthropic
 * call with no guardrails; W7 unifies it on generateDraft() so the
 * same voice profile, examples, banned-phrase enforcement, and
 * retry-with-nudge logic apply on BOTH manual and auto paths.
 *
 * messageClass is hardcoded to 'follow_up' — staff click Draft when
 * they want to proactively re-engage a lead. The auto-draft path
 * (inbound webhook) uses 'greeting'/'faq' based on history. A future
 * UI dropdown could let staff override the class.
 */

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
  const org   = profile.organization as { name?: string } | null

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

  const { data: contact } = await supabase
    .from('contacts_active')
    .select('id, first_name, procedure_interest, source, status, created_at, last_contacted_at, organization_id')
    .eq('id', contactId)
    .eq('organization_id', orgId)
    .single()

  if (!contact) return NextResponse.json({ error: 'Contact not found' }, { status: 404 })

  // Rate limit: 20 ai_draft_generated entries per org per hour.
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

  // Recent message history (last 5, oldest first to match DraftContext).
  const { data: recentMessagesRaw } = await supabase
    .from('messages')
    .select('channel, direction, body, created_at')
    .eq('contact_id', contactId)
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
    .limit(5)

  const recentMessages = ((recentMessagesRaw ?? []) as Array<{ channel: string; direction: 'inbound' | 'outbound'; body: string }>)
    .reverse()
    .map(m => ({ channel: m.channel, direction: m.direction, body: m.body ?? '' }))

  const ctx: DraftContext = {
    contactId,
    organizationId: orgId,
    channel,
    firstName: (contact.first_name as string | null) ?? 'there',
    procedureInterest: (contact.procedure_interest as string[] | null) ?? [],
    source: (contact.source as string | null) ?? null,
    status: (contact.status as string | null) ?? null,
    daysSinceCreated: daysSince(contact.created_at as string),
    daysSinceLastContact: contact.last_contacted_at
      ? daysSince(contact.last_contacted_at as string)
      : null,
    clinicName: org?.name ?? 'our clinic',
    recentMessages,
    triggerMessageId: null,
    messageClass: 'follow_up',
  }

  const result = await generateDraft(ctx)

  if (!result.ok) {
    if (result.reason === 'guardrail_failed') {
      return NextResponse.json(
        {
          error: 'guardrail_failed',
          message: "AI draft hit a safety rule — try clicking Draft again.",
          violation: result.violation ?? null,
        },
        { status: 502 },
      )
    }
    if (result.reason === 'empty') {
      return NextResponse.json(
        { error: 'empty_response', message: "Couldn't generate draft — try again." },
        { status: 502 },
      )
    }
    return NextResponse.json(
      { error: 'draft_failed', message: "Couldn't generate draft — try again.", detail: result.detail },
      { status: 502 },
    )
  }

  // Log the draft event for rate-limiting + observability. Body
  // intentionally NOT stored — drafts aren't sends, and manual
  // drafts don't land in ai_drafts (only auto-drafts do, by design).
  await supabase.from('activity_log').insert({
    organization_id: orgId,
    contact_id:      contactId,
    action:          'ai_draft_generated',
    metadata: {
      channel,
      model: 'claude-haiku-4-5',
      trigger: 'manual',
      voice_class: (result.contextSnapshot?.voice_class as string | undefined) ?? null,
      voice_examples_used: (result.contextSnapshot?.voice_examples_used as number | undefined) ?? 0,
    },
  })

  if (channel === 'email') {
    return NextResponse.json({ subject: result.subject ?? '', draft: result.body })
  }
  // SMS: the W7 unified prompt forbids a model-emitted signature
  // because the inbound auto-draft path has the disclosure footer
  // appended at send time. The manual path doesn't get that footer
  // (no draft_id, no AI-disclosure path), so we append a plain
  // clinic-name signoff here so staff don't have to type it every
  // time. Matches the W6 manual-draft user experience.
  const clinicName = org?.name ?? 'our clinic'
  const signedOff = `${result.body}\n— ${clinicName}`
  return NextResponse.json({ draft: signedOff })
}

function daysSince(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime()
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)))
}
