import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { enrollContact } from '@/lib/automation-engine'
import { enqueueEnrollment, enrollmentJobsMode } from '@/lib/enrollment-jobs'
import { sendConsultationSms } from '@/lib/consultation-reminders'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { z } from 'zod'

const VALID_TYPES = ['in_person', 'virtual'] as const

const createConsultationSchema = z.object({
  contact_id:          z.string().uuid(),
  scheduled_at:        z.string().datetime(),
  duration_min:        z.number().int().min(15).max(480).optional(),
  type:                z.enum(VALID_TYPES).optional(),
  assigned_to:         z.string().uuid().nullable().optional(),
  pre_consult_notes:   z.string().max(2000).optional(),
  procedure_discussed: z.array(z.string()).optional().default([]),
})

// ─── GET /api/consultations ───────────────────────────────────
// Query params (all optional):
//   status  — filter by ConsultationStatus
//   from    — ISO datetime lower bound on scheduled_at
//   to      — ISO datetime upper bound on scheduled_at
export async function GET(req: NextRequest) {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single()

  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const from   = searchParams.get('from')
  const to     = searchParams.get('to')

  let query = supabase
    .from('consultations')
    .select(`
      id,
      organization_id,
      contact_id,
      assigned_to,
      scheduled_at,
      duration_min,
      type,
      status,
      procedure_discussed,
      pre_consult_notes,
      post_consult_notes,
      reminder_24h_sent,
      reminder_2h_sent,
      created_at,
      updated_at,
      contact:contacts ( id, first_name, last_name, email, phone ),
      assignee:profiles ( full_name )
    `)
    .eq('organization_id', profile.organization_id)
    .order('scheduled_at', { ascending: true })

  if (status) query = query.eq('status', status)
  if (from)   query = query.gte('scheduled_at', from)
  if (to)     query = query.lte('scheduled_at', to)

  const { data, error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data ?? [])
}

// ─── POST /api/consultations ──────────────────────────────────
export async function POST(req: NextRequest) {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single()

  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  const body = await req.json()
  const parsed = createConsultationSchema.safeParse(body)
  if (!parsed.success) {
    const firstError = parsed.error.issues[0]
    return NextResponse.json({ error: firstError.message }, { status: 400 })
  }

  const { contact_id, ...fields } = parsed.data

  // Confirm contact belongs to this org
  const { data: contact, error: contactError } = await supabase
    .from('contacts_active')
    .select('id, stage_id')
    .eq('id', contact_id)
    .eq('organization_id', profile.organization_id)
    .single()

  if (contactError || !contact) {
    return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
  }

  // Create the consultation
  const { data: consultation, error: insertError } = await supabase
    .from('consultations')
    .insert({
      duration_min: 60,
      type: 'in_person',
      ...fields,
      contact_id,
      organization_id: profile.organization_id,
      status: 'scheduled',
    })
    .select('id')
    .single()

  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 })

  // Move contact to "Consultation Booked" stage if it exists for this org
  const { data: bookedStage } = await supabase
    .from('pipeline_stages')
    .select('id')
    .eq('organization_id', profile.organization_id)
    .ilike('name', 'consultation booked')
    .single()

  await supabase
    .from('contacts')
    .update({
      last_activity_at: new Date().toISOString(),
      ...(bookedStage ? { stage_id: bookedStage.id } : {}),
    })
    .eq('id', contact_id)

  // Activity log
  await supabase.from('activity_log').insert({
    organization_id: profile.organization_id,
    contact_id,
    user_id: user.id,
    action: 'consultation_booked',
    metadata: { consultation_id: consultation.id, scheduled_at: fields.scheduled_at },
  })

  // Durable enrollment: /api/cron drains the queue. Shadow mode keeps the
  // legacy fire-and-forget alongside the enqueue until ENROLLMENT_JOBS_MODE=primary.
  try {
    await enqueueEnrollment({
      contactId: contact_id,
      organizationId: profile.organization_id,
      triggerType: 'consultation_booked',
    })
  } catch {
    // Logged inside enqueueEnrollment
  }
  if (enrollmentJobsMode() === 'shadow') {
    enrollContact({
      contactId: contact_id,
      organizationId: profile.organization_id,
      triggerType: 'consultation_booked',
    }).catch((err) => console.error('Consultation booked enrollment failed:', err))
  }

  // Confirmation SMS (fire-and-forget — never block the response)
  ;(async () => {
    try {
      const [{ data: orgSms }, { data: contactSms }] = await Promise.all([
        supabaseAdmin
          .from('organizations')
          .select(`
            name, timezone,
            sms_enabled, sms_confirmation_enabled,
            sms_template_confirmation
          `)
          .eq('id', profile.organization_id)
          .single(),
        supabaseAdmin
          .from('contacts_active')
          .select('id, first_name, phone, opted_out_sms, sms_consent')
          .eq('id', contact_id)
          .single(),
      ])

      if (orgSms && contactSms) {
        await sendConsultationSms({
          type: 'confirmation',
          org: orgSms as any,
          contact: contactSms,
          consultation: {
            id: consultation.id,
            organization_id: profile.organization_id,
            scheduled_at: parsed.data.scheduled_at,
          },
        })
      }
    } catch (err) {
      console.error('[confirmation sms] failed:', err)
    }
  })()

  return NextResponse.json({ id: consultation.id }, { status: 201 })
}
