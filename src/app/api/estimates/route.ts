import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

const lineItemSchema = z.object({
  description: z.string().min(1, 'Description is required').max(500),
  quantity: z.coerce.number().positive('Quantity must be greater than 0'),
  unit_price_cents: z.coerce.number().int().min(0, 'Price must be 0 or more'),
})

const createEstimateSchema = z.object({
  contact_id: z.string().uuid('Invalid client'),
  title: z.string().min(1, 'Title is required').max(200),
  tax_cents: z.coerce.number().int().min(0).optional(),
  notes: z.string().max(2000).optional(),
  line_items: z.array(lineItemSchema).min(1, 'Add at least one line item'),
})

async function resolveOrg(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: 'Unauthorized', status: 401 as const }

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single()

  if (!profile) return { error: 'Profile not found', status: 404 as const }
  return { user, organizationId: profile.organization_id as string }
}

// ─── GET /api/estimates ───────────────────────────────────────
// List the org's estimates, newest first, with the client's first name.
export async function GET() {
  const supabase = await createClient()
  const ctx = await resolveOrg(supabase)
  if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status })

  const { data, error } = await supabase
    .from('estimates')
    .select('id, estimate_number, status, total_cents, title, created_at, contact:contacts(first_name)')
    .eq('organization_id', ctx.organizationId)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const normalized = (data ?? []).map((e: any) => ({
    id: e.id,
    estimate_number: e.estimate_number,
    status: e.status,
    total_cents: e.total_cents,
    title: e.title,
    created_at: e.created_at,
    first_name: e.contact?.first_name ?? null,
  }))

  return NextResponse.json(normalized)
}

// ─── POST /api/estimates ──────────────────────────────────────
// Create a draft estimate + its line items in the owner's org.
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const ctx = await resolveOrg(supabase)
  if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status })
  const { user, organizationId } = ctx

  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }
  const parsed = createEstimateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }
  const { contact_id, title, notes, line_items } = parsed.data
  const tax_cents = parsed.data.tax_cents ?? 0

  // Verify the contact belongs to this org before referencing it.
  const { data: contact } = await supabase
    .from('contacts')
    .select('id')
    .eq('id', contact_id)
    .eq('organization_id', organizationId)
    .single()
  if (!contact) {
    return NextResponse.json({ error: 'Client not found.' }, { status: 404 })
  }

  // Money math in integer cents. quantity is numeric; round the product
  // so fractional quantities can't leak sub-cent totals into the DB.
  const subtotal_cents = line_items.reduce(
    (sum, li) => sum + Math.round(li.quantity * li.unit_price_cents),
    0
  )
  const total_cents = subtotal_cents + tax_cents

  // Sequential per-org estimate number.
  const { data: numberData, error: numberError } = await supabase.rpc('next_document_number', {
    p_org: organizationId,
    p_kind: 'estimate',
  })
  if (numberError || numberData == null) {
    return NextResponse.json(
      { error: numberError?.message ?? 'Could not assign estimate number.' },
      { status: 500 }
    )
  }
  const estimate_number = Number(numberData)

  const { data: estimate, error: insertError } = await supabase
    .from('estimates')
    .insert({
      organization_id: organizationId,
      contact_id,
      estimate_number,
      status: 'draft',
      title,
      notes: notes || null,
      subtotal_cents,
      tax_cents,
      total_cents,
      created_by: user.id,
    })
    .select('id, estimate_number')
    .single()

  if (insertError || !estimate) {
    return NextResponse.json(
      { error: insertError?.message ?? 'Could not create estimate.' },
      { status: 500 }
    )
  }

  const rows = line_items.map((li, i) => ({
    estimate_id: estimate.id,
    organization_id: organizationId,
    description: li.description,
    quantity: li.quantity,
    unit_price_cents: li.unit_price_cents,
    position: i,
  }))
  const { error: itemsError } = await supabase.from('estimate_line_items').insert(rows)
  if (itemsError) {
    // Roll back the header so we don't leave an estimate with no lines.
    await supabase.from('estimates').delete().eq('id', estimate.id).eq('organization_id', organizationId)
    return NextResponse.json({ error: itemsError.message }, { status: 500 })
  }

  return NextResponse.json(
    { id: estimate.id, estimate_number: estimate.estimate_number },
    { status: 201 }
  )
}
