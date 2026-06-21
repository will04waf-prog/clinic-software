import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { z } from 'zod'
import { enrollContact } from '@/lib/automation-engine'
import { enqueueEnrollment, enrollmentJobsMode } from '@/lib/enrollment-jobs'

const CaptureSchema = z.object({
  first_name:          z.string().min(1),
  last_name:           z.string().optional(),
  email:               z.string().email().optional().or(z.literal('')),
  phone:               z.string().optional(),
  procedure_interest:  z.array(z.string()).optional(),
  notes:               z.string().optional(),
  sms_consent:         z.boolean().optional().default(false),
})

// GET — verify slug is valid (used by the form page to load org info)
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const supabase = await createClient()

  const { data: org } = await supabase
    .from('organizations')
    .select('id, name, slug, procedures')
    .eq('slug', slug)
    .single()

  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({ org })
}

// POST — submit a lead from the public form.
//
// Public visitors filling out a clinic's intake form have no Supabase
// session, so the cookie-based anon client gets rejected by the
// org_isolation RLS policy on contacts. The slug in the URL is the
// authorization mechanism here — anyone who hits /api/capture/<slug>
// is implicitly permitted to create a lead for that specific org. We
// validate the slug, then use the service-role client to perform the
// writes, bypassing RLS in a controlled way.
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('id, name')
    .eq('slug', slug)
    .single()

  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await request.json()
  const parsed = CaptureSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const { email, sms_consent, ...rest } = parsed.data

  // Get default stage for org
  const { data: defaultStage } = await supabaseAdmin
    .from('pipeline_stages')
    .select('id')
    .eq('organization_id', org.id)
    .eq('is_default', true)
    .maybeSingle()

  const { data: contact, error } = await supabaseAdmin
    .from('contacts')
    .insert({
      organization_id:    org.id,
      stage_id:           defaultStage?.id ?? null,
      email:              email || null,
      source:             'website',
      sms_consent:        sms_consent ?? false,
      ...rest,
      procedure_interest: rest.procedure_interest ?? [],
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Log activity
  await supabaseAdmin.from('activity_log').insert({
    organization_id: org.id,
    contact_id:      contact.id,
    action:          'lead_captured',
    metadata:        { source: 'web_form', slug },
  })

  // Durable enrollment: /api/cron drains the queue. Shadow mode keeps the
  // legacy fire-and-forget alongside the enqueue until ENROLLMENT_JOBS_MODE=primary.
  try {
    await enqueueEnrollment({
      contactId:      contact.id,
      organizationId: org.id,
      triggerType:    'new_lead',
    })
  } catch {
    // Logged inside enqueueEnrollment
  }
  if (enrollmentJobsMode() === 'shadow') {
    enrollContact({
      contactId:      contact.id,
      triggerType:    'new_lead',
      organizationId: org.id,
    }).catch(console.error)
  }

  return NextResponse.json({ ok: true }, { status: 201 })
}
