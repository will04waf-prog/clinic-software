import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { enrollContact } from '@/lib/automation-engine'
import { enqueueEnrollment, enrollmentJobsMode } from '@/lib/enrollment-jobs'
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

async function resolveOrgId(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  const { data } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', userId)
    .single()
  return data?.organization_id ?? null
}

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

  const { data: consultation, error: fetchError } = await supabase
    .from('consultations')
    .select('id, status, contact_id, organization_id')
    .eq('id', id)
    .eq('organization_id', orgId)
    .single()

  if (fetchError || !consultation) {
    return NextResponse.json({ error: 'Consultation not found' }, { status: 404 })
  }

  const body = await req.json()
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const updates = parsed.data
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields provided' }, { status: 400 })
  }

  const statusChanged = updates.status && updates.status !== consultation.status

  const { error: updateError } = await supabase
    .from('consultations')
    .update(updates)
    .eq('id', id)
    .eq('organization_id', orgId)

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

  if (statusChanged && updates.status) {
    // Activity log
    await supabaseAdmin.from('activity_log').insert({
      organization_id: orgId,
      contact_id:      consultation.contact_id,
      user_id:         user.id,
      action:          `consultation_${updates.status}`,
      metadata:        { consultation_id: id },
    })

    if (updates.status === 'completed') {
      // Look up "Consultation Done" stage
      const { data: doneStage } = await supabaseAdmin
        .from('pipeline_stages')
        .select('id')
        .eq('organization_id', orgId)
        .ilike('name', 'consultation done')
        .maybeSingle()

      const { error: contactErr } = await supabaseAdmin
        .from('contacts')
        .update({
          status:           'patient',
          last_activity_at: new Date().toISOString(),
          ...(doneStage ? { stage_id: doneStage.id } : {}),
        })
        .eq('id', consultation.contact_id)
        .eq('organization_id', orgId)

      if (contactErr) console.error('[consultations] contact update failed:', contactErr.message)

      // Durable enrollment: /api/cron drains the queue. Shadow mode keeps the
      // legacy call alongside the enqueue until ENROLLMENT_JOBS_MODE=primary.
      try {
        await enqueueEnrollment({
          contactId:      consultation.contact_id,
          organizationId: orgId,
          triggerType:    'consultation_completed',
        })
      } catch {
        // Logged inside enqueueEnrollment
      }
      if (enrollmentJobsMode() === 'shadow') {
        await enrollContact({
          contactId:      consultation.contact_id,
          organizationId: orgId,
          triggerType:    'consultation_completed',
        }).catch((err) => console.error('Post-consult enrollment failed:', err))
      }
    }

    if (updates.status === 'no_show') {
      const { data: noShowStage } = await supabaseAdmin
        .from('pipeline_stages')
        .select('id')
        .eq('organization_id', orgId)
        .ilike('name', 'no-show')
        .maybeSingle()

      const { error: noShowContactErr } = await supabaseAdmin
        .from('contacts')
        .update({
          last_activity_at: new Date().toISOString(),
          ...(noShowStage ? { stage_id: noShowStage.id } : {}),
        })
        .eq('id', consultation.contact_id)
        .eq('organization_id', orgId)

      if (noShowContactErr) console.error('[consultations] contact stage update failed:', noShowContactErr.message)

      // Durable enrollment: /api/cron drains the queue. Shadow mode keeps the
      // legacy call alongside the enqueue until ENROLLMENT_JOBS_MODE=primary.
      try {
        await enqueueEnrollment({
          contactId:      consultation.contact_id,
          organizationId: orgId,
          triggerType:    'no_show',
        })
      } catch {
        // Logged inside enqueueEnrollment
      }
      if (enrollmentJobsMode() === 'shadow') {
        await enrollContact({
          contactId:      consultation.contact_id,
          organizationId: orgId,
          triggerType:    'no_show',
        }).catch((err) => console.error('No-show enrollment failed:', err))
      }
    }
  }

  return NextResponse.json({ ok: true })
}
