import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'
import { enrollContact } from '@/lib/automation-engine'

const CaptureSchema = z.object({
  first_name:          z.string().min(1),
  last_name:           z.string().optional(),
  email:               z.string().email().optional().or(z.literal('')),
  phone:               z.string().optional(),
  procedure_interest:  z.array(z.string()).optional(),
  notes:               z.string().optional(),
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

// POST — submit a lead from the public form
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const supabase = await createClient()

  const { data: org } = await supabase
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

  const { email, ...rest } = parsed.data

  // Get default stage for org
  const { data: defaultStage } = await supabase
    .from('pipeline_stages')
    .select('id')
    .eq('organization_id', org.id)
    .eq('is_default', true)
    .maybeSingle()

  const { data: contact, error } = await supabase
    .from('contacts')
    .insert({
      organization_id:    org.id,
      stage_id:           defaultStage?.id ?? null,
      email:              email || null,
      source:             'website',
      ...rest,
      procedure_interest: rest.procedure_interest ?? [],
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Log activity
  await supabase.from('activity_log').insert({
    organization_id: org.id,
    contact_id:      contact.id,
    action:          'lead_captured',
    metadata:        { source: 'web_form', slug },
  })

  // Fire automation (fire-and-forget)
  enrollContact({
    contactId:      contact.id,
    triggerType:    'new_lead',
    organizationId: org.id,
  }).catch(console.error)

  return NextResponse.json({ ok: true }, { status: 201 })
}
