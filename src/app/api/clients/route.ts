import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { normalizePhone } from '@/lib/validators'
import { z } from 'zod'

const createClientSchema = z.object({
  first_name: z.string().min(1, 'Name is required').max(100),
  phone: z.string().min(1, 'Phone is required').max(30),
  preferred_language: z.enum(['es', 'en']).optional(),
})

// ─── POST /api/clients ────────────────────────────────────────
// Minimal add-client for the estimate builder. Owner-auth, org-scoped.
// Mirrors the default-stage resolution + insert shape in /api/leads.
export async function POST(req: NextRequest) {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single()

  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }
  const parsed = createClientSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const phone = normalizePhone(parsed.data.phone)
  if (!phone) {
    return NextResponse.json({ error: 'Invalid phone number.' }, { status: 400 })
  }

  // Default pipeline stage (same resolution as /api/leads).
  const { data: defaultStage } = await supabase
    .from('pipeline_stages')
    .select('id')
    .eq('organization_id', profile.organization_id)
    .eq('is_default', true)
    .single()

  const { data: contact, error: insertError } = await supabase
    .from('contacts')
    .insert({
      first_name: parsed.data.first_name,
      phone,
      preferred_language: parsed.data.preferred_language ?? null,
      organization_id: profile.organization_id,
      stage_id: defaultStage?.id ?? null,
      status: 'lead',
    })
    .select('id, first_name, phone')
    .single()

  if (insertError || !contact) {
    return NextResponse.json(
      { error: insertError?.message ?? 'Could not create client.' },
      { status: 500 }
    )
  }

  return NextResponse.json(
    { id: contact.id, first_name: contact.first_name, phone: contact.phone },
    { status: 201 }
  )
}
