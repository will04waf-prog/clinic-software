import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { enrollContact } from '@/lib/automation-engine'
import { z } from 'zod'

const VALID_STATUSES = [
  'scheduled',
  'confirmed',
  'completed',
  'no_show',
  'canceled',
  'rescheduled',
] as const

const patchSchema = z.object({
  status:             z.enum(VALID_STATUSES).optional(),
  post_consult_notes: z.string().max(2000).optional(),
  assigned_to:        z.string().uuid().nullable().optional(),
  scheduled_at:       z.string().datetime().optional(),
}).strict()

// ─── Helpers ─────────────────────────────────────────────────

async function resolveOrgId(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  const { data } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', userId)
    .single()
  return data?.organization_id ?? null
}

// ─── PATCH /api/consultations/[id] ───────────────────────────
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

  // Fetch existing consultation — confirms it belongs to this org
  const { data: consultation, error: fetchError } = await supabase
    .from('consultations')
    .select('id, status, contact_id, organization_id')
    .eq('id', id)
    .eq('organization_id', orgId)
    .single()

  if (fetchError || !consultation) {
    return NextResponse.json({ error: 'Consultation not found' }, { status: 404 })
  }

  // Validate body
  const body = await req.json()
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    const firstError = parsed.error.issues[0]
    return NextResponse.json({ error: firstError.message }, { status: 400 })
  }

  const updates = parsed.data

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields provided' }, { status: 400 })
  }

  const statusChanged = updates.status && updates.status !== consultation.status

  // Apply the update
  const { error: updateError } = await supabase
    .from('consultations')
    .update(updates)
    .eq('id', id)
    .eq('organization_id', orgId)

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

  // ── Side effects on status change ──────────────────────────
  if (statusChanged && updates.status) {
    // 1. Activity log
    await supabase.from('activity_log').insert({
      organization_id: orgId,
      contact_id: consultation.contact_id,
      user_id: user.id,
      action: `consultation_${updates.status}`,  // e.g. consultation_no_show
      metadata: { consultation_id: id },
    })

    // 2. Promote contact to patient on completion
    if (updates.status === 'completed') {
      await supabase
        .from('contacts')
        .update({ status: 'patient', last_activity_at: new Date().toISOString() })
        .eq('id', consultation.contact_id)
        .eq('organization_id', orgId)
    }

    // 3. Enroll in no-show recovery sequence (fire-and-forget)
    if (updates.status === 'no_show') {
      enrollContact({
        contactId: consultation.contact_id,
        organizationId: orgId,
        triggerType: 'no_show',
      }).catch((err) => console.error('No-show enrollment failed:', err))
    }

    // 4. Enroll in post-consultation sequence (fire-and-forget)
    if (updates.status === 'completed') {
      enrollContact({
        contactId: consultation.contact_id,
        organizationId: orgId,
        triggerType: 'consultation_completed',
      }).catch((err) => console.error('Post-consult enrollment failed:', err))
    }
  }

  return NextResponse.json({ ok: true })
}
