import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const StepSchema = z.object({
  channel:      z.enum(['email', 'sms']),
  delay_hours:  z.number().int().min(0),
  subject:      z.string().optional().nullable(),
  body:         z.string().min(1),
  position:     z.number().int().min(0),
})

const UpdateSchema = z.object({
  name:         z.string().min(1).optional(),
  trigger_type: z.enum(['new_lead','stage_changed','no_show','old_lead_reactivation','consultation_booked','consultation_completed']).optional(),
  is_active:    z.boolean().optional(),
  steps:        z.array(StepSchema).min(1).optional(),
})

async function getOrgId(supabase: any) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('profiles').select('organization_id').eq('id', user.id).single()
  return profile?.organization_id ?? null
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const orgId = await getOrgId(supabase)
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const parsed = UpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const { steps, ...seqUpdates } = parsed.data

  if (Object.keys(seqUpdates).length > 0) {
    const { error } = await supabase
      .from('automation_sequences')
      .update(seqUpdates)
      .eq('id', id)
      .eq('organization_id', orgId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Replace steps if provided
  if (steps) {
    await supabase.from('sequence_steps').delete().eq('sequence_id', id)
    const stepRows = steps.map((s, i) => ({
      sequence_id: id,
      channel:     s.channel,
      delay_hours: s.delay_hours,
      subject:     s.subject ?? null,
      body:        s.body,
      position:    i,
    }))
    const { error: stepsErr } = await supabase.from('sequence_steps').insert(stepRows)
    if (stepsErr) return NextResponse.json({ error: stepsErr.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const orgId = await getOrgId(supabase)
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { error } = await supabase
    .from('automation_sequences')
    .delete()
    .eq('id', id)
    .eq('organization_id', orgId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
