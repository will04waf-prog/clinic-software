import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { checkFeatureAccess } from '@/lib/billing/enforce-tier'
import { z } from 'zod'

const StepSchema = z.object({
  channel:      z.enum(['email', 'sms']),
  delay_hours:  z.number().int().min(0),
  subject:      z.string().optional().nullable(),
  body:         z.string().min(1),
  position:     z.number().int().min(0),
})

const CreateSchema = z.object({
  name:         z.string().min(1),
  trigger_type: z.enum(['new_lead','stage_changed','no_show','old_lead_reactivation','consultation_booked','consultation_completed']),
  is_active:    z.boolean().optional().default(true),
  steps:        z.array(StepSchema).min(1),
})

async function getOrgId(supabase: any) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('profiles').select('organization_id').eq('id', user.id).single()
  return profile?.organization_id ?? null
}

export async function GET() {
  const supabase = await createClient()
  const orgId = await getOrgId(supabase)
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('automation_sequences')
    .select('*, steps:sequence_steps(*)')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Sort steps by position inside each sequence
  const sequences = (data ?? []).map((seq: any) => ({
    ...seq,
    steps: (seq.steps ?? []).sort((a: any, b: any) => a.position - b.position),
  }))

  return NextResponse.json({ sequences })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const orgId = await getOrgId(supabase)
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const parsed = CreateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  // Tier gate: block sequence creation on tiers without automation access.
  const featureCheck = await checkFeatureAccess(supabase, orgId, 'automation')
  if (!featureCheck.ok) {
    return NextResponse.json(featureCheck.error, { status: featureCheck.status })
  }

  const { steps, ...seqData } = parsed.data

  const { data: sequence, error: seqErr } = await supabase
    .from('automation_sequences')
    .insert({ ...seqData, organization_id: orgId })
    .select()
    .single()

  if (seqErr) return NextResponse.json({ error: seqErr.message }, { status: 500 })

  const stepRows = steps.map((s, i) => ({
    sequence_id: sequence.id,
    channel:     s.channel,
    delay_hours: s.delay_hours,
    subject:     s.subject ?? null,
    body:        s.body,
    position:    i,
  }))

  const { error: stepsErr } = await supabase.from('sequence_steps').insert(stepRows)
  if (stepsErr) return NextResponse.json({ error: stepsErr.message }, { status: 500 })

  return NextResponse.json({ sequence }, { status: 201 })
}
