import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { enrollContact } from '@/lib/automation-engine'
import { enqueueEnrollment, enrollmentJobsMode } from '@/lib/enrollment-jobs'
import { checkContactLimit } from '@/lib/billing/enforce-tier'
import { z } from 'zod'

const VALID_SOURCES = ['website', 'referral', 'instagram', 'facebook', 'walkin', 'other'] as const

const createLeadSchema = z.object({
  first_name: z.string().min(1, 'First name is required').max(100),
  last_name: z.string().max(100).optional(),
  email: z.string().email('Invalid email address').optional().or(z.literal('')),
  phone: z.string().max(30).optional(),
  source: z.enum(VALID_SOURCES).optional(),
  procedure_interest: z.array(z.string()).optional(),
  notes: z.string().max(2000).optional(),
  stage_id: z.string().uuid().optional(),
})

// ─── GET /api/leads ───────────────────────────────────────────
export async function GET(req: NextRequest) {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Resolve org
  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single()

  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')         // lead | patient | inactive
  const archived = searchParams.get('archived') === 'true'

  let query = supabase
    .from('contacts_active')
    .select('*, stage:pipeline_stages(*), tags:contact_tags(tag:tags(*))')
    .eq('organization_id', profile.organization_id)
    .eq('is_archived', archived)
    .order('last_activity_at', { ascending: false })

  if (status) query = query.eq('status', status)

  // Run in parallel: contacts + latest inbound timestamp per contact.
  // The inbound query is org-scoped and indexed on contact_id; we then
  // reduce in JS to a Map<contact_id, latestCreatedAt>.
  const [{ data: contacts, error }, { data: inbound, error: inboundError }] = await Promise.all([
    query,
    supabase
      .from('messages')
      .select('contact_id, created_at')
      .eq('organization_id', profile.organization_id)
      .eq('direction', 'inbound')
      .order('created_at', { ascending: false }),
  ])

  if (error)        return NextResponse.json({ error: error.message },        { status: 500 })
  if (inboundError) return NextResponse.json({ error: inboundError.message }, { status: 500 })

  const latestInboundByContact = new Map<string, string>()
  for (const row of inbound ?? []) {
    if (!row.contact_id) continue
    // Rows are ordered created_at desc, so the first hit per contact wins.
    if (!latestInboundByContact.has(row.contact_id)) {
      latestInboundByContact.set(row.contact_id, row.created_at)
    }
  }

  // Flatten the nested tags join + derive has_unread.
  const normalized = (contacts ?? []).map((c: any) => {
    const latest = latestInboundByContact.get(c.id)
    const seen   = c.messages_last_seen_at
    return {
      ...c,
      tags: (c.tags ?? []).map((t: any) => t.tag).filter(Boolean),
      has_unread: !!latest && (!seen || latest > seen),
    }
  })

  return NextResponse.json(normalized)
}

// ─── POST /api/leads ──────────────────────────────────────────
export async function POST(req: NextRequest) {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Resolve org
  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single()

  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  // Validate body
  const body = await req.json()
  const parsed = createLeadSchema.safeParse(body)
  if (!parsed.success) {
    const firstError = parsed.error.issues[0]
    return NextResponse.json({ error: firstError.message }, { status: 400 })
  }

  const { stage_id, email, ...fields } = parsed.data

  // Resolve default stage if none provided
  let resolvedStageId = stage_id
  if (!resolvedStageId) {
    const { data: defaultStage } = await supabase
      .from('pipeline_stages')
      .select('id')
      .eq('organization_id', profile.organization_id)
      .eq('is_default', true)
      .single()

    resolvedStageId = defaultStage?.id ?? undefined
  }

  // Tier gate: block insert if at/over maxContacts for current plan.
  const limitCheck = await checkContactLimit(supabase, profile.organization_id)
  if (!limitCheck.ok) {
    return NextResponse.json(limitCheck.error, { status: limitCheck.status })
  }

  // Create the contact
  const { data: contact, error: insertError } = await supabase
    .from('contacts')
    .insert({
      ...fields,
      email: email || null,           // store null not empty string
      organization_id: profile.organization_id,
      stage_id: resolvedStageId ?? null,
      status: 'lead',
    })
    .select('id')
    .single()

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  // Log activity
  await supabase.from('activity_log').insert({
    organization_id: profile.organization_id,
    contact_id: contact.id,
    user_id: user.id,
    action: 'lead_created',
  })

  // Durable enrollment: /api/cron drains the queue. Shadow mode keeps the
  // legacy in-request call alongside the enqueue so behavior is unchanged
  // until ENROLLMENT_JOBS_MODE=primary.
  try {
    await enqueueEnrollment({
      contactId: contact.id,
      organizationId: profile.organization_id,
      triggerType: 'new_lead',
    })
  } catch {
    // Logged inside enqueueEnrollment
  }
  if (enrollmentJobsMode() === 'shadow') {
    await enrollContact({
      contactId: contact.id,
      organizationId: profile.organization_id,
      triggerType: 'new_lead',
    }).catch((err) => console.error('Automation enrollment failed:', err))
  }

  return NextResponse.json({ id: contact.id }, { status: 201 })
}
