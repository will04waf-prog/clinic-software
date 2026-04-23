import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

const VALID_SOURCES = ['website', 'referral', 'instagram', 'facebook', 'walkin', 'other'] as const
const VALID_STATUSES = ['lead', 'patient', 'inactive'] as const

const patchSchema = z.object({
  stage_id:            z.string().uuid().nullable().optional(),
  is_archived:         z.boolean().optional(),
  status:              z.enum(VALID_STATUSES).optional(),
  source:              z.enum(VALID_SOURCES).optional(),
  procedure_interest:  z.array(z.string()).optional(),
  notes:               z.string().max(2000).optional(),
  opted_out_sms:       z.boolean().optional(),
  opted_out_email:     z.boolean().optional(),
}).strict() // reject any unknown keys

// ─── Helpers ─────────────────────────────────────────────────

async function resolveOrgId(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  const { data } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', userId)
    .single()
  return data?.organization_id ?? null
}

async function getContact(
  supabase: Awaited<ReturnType<typeof createClient>>,
  id: string,
  orgId: string
) {
  const { data, error } = await supabase
    .from('contacts_active')
    .select('*, stage:pipeline_stages(*), tags:contact_tags(tag:tags(*))')
    .eq('id', id)
    .eq('organization_id', orgId) // org isolation enforced here too, not just RLS
    .single()

  return { data, error }
}

// ─── GET /api/contacts/[id] ───────────────────────────────────
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const orgId = await resolveOrgId(supabase, user.id)
  if (!orgId) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  const { data: contact, error } = await getContact(supabase, id, orgId)

  if (error || !contact) return NextResponse.json({ error: 'Contact not found' }, { status: 404 })

  // Flatten nested tags join
  const normalized = {
    ...contact,
    tags: (contact.tags ?? []).map((t: any) => t.tag).filter(Boolean),
  }

  return NextResponse.json(normalized)
}

// ─── PATCH /api/contacts/[id] ─────────────────────────────────
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const orgId = await resolveOrgId(supabase, user.id)
  if (!orgId) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  // Confirm contact belongs to this org before updating
  const { data: existing, error: fetchError } = await supabase
    .from('contacts_active')
    .select('id, stage_id')
    .eq('id', id)
    .eq('organization_id', orgId)
    .single()

  if (fetchError || !existing) {
    return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
  }

  // Validate body
  const body = await req.json()
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    const firstError = parsed.error.issues[0]
    return NextResponse.json({ error: firstError.message }, { status: 400 })
  }

  const updates = parsed.data

  // Nothing to update
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields provided' }, { status: 400 })
  }

  const { error: updateError } = await supabase
    .from('contacts')
    .update({ ...updates, last_activity_at: new Date().toISOString() })
    .eq('id', id)
    .eq('organization_id', orgId)

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

  // Log meaningful activity events
  const activityAction = resolveActivityAction(updates, existing)
  if (activityAction) {
    await supabase.from('activity_log').insert({
      organization_id: orgId,
      contact_id: id,
      user_id: user.id,
      action: activityAction,
      metadata: updates.stage_id ? { stage_id: updates.stage_id } : null,
    })
  }

  return NextResponse.json({ ok: true })
}

function resolveActivityAction(
  updates: z.infer<typeof patchSchema>,
  existing: { stage_id: string | null }
): string | null {
  if (updates.is_archived === true) return 'contact_archived'
  if (updates.stage_id !== undefined && updates.stage_id !== existing.stage_id) return 'stage_changed'
  if (updates.status) return 'status_changed'
  if (updates.notes !== undefined) return 'note_added'
  return null
}
