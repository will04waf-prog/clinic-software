import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { enrollContact } from '@/lib/automation-engine'
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
    .from('contacts')
    .select('*, stage:pipeline_stages(*), tags:contact_tags(tag:tags(*))')
    .eq('organization_id', profile.organization_id)
    .eq('is_archived', archived)
    .order('last_activity_at', { ascending: false })

  if (status) query = query.eq('status', status)

  const { data: contacts, error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Flatten the nested tags join
  const normalized = (contacts ?? []).map((c: any) => ({
    ...c,
    tags: (c.tags ?? []).map((t: any) => t.tag).filter(Boolean),
  }))

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

  // Enroll in automations before returning — fire-and-forget is cut off on Vercel
  await enrollContact({
    contactId: contact.id,
    organizationId: profile.organization_id,
    triggerType: 'new_lead',
  }).catch((err) => console.error('Automation enrollment failed:', err))

  return NextResponse.json({ id: contact.id }, { status: 201 })
}
