import { NextRequest, NextResponse } from 'next/server'
import type { TablesUpdate } from '@/types/database'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

const lineItemSchema = z.object({
  description: z.string().min(1, 'Description is required').max(500),
  quantity: z.coerce.number().positive('Quantity must be greater than 0'),
  unit_price_cents: z.coerce.number().int().min(0, 'Price must be 0 or more'),
})

const patchEstimateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  notes: z.string().max(2000).nullable().optional(),
  tax_cents: z.coerce.number().int().min(0).optional(),
  line_items: z.array(lineItemSchema).min(1, 'Add at least one line item').optional(),
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

// ─── GET /api/estimates/[id] ──────────────────────────────────
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const ctx = await resolveOrg(supabase)
  if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status })

  const { data: estimate, error } = await supabase
    .from('estimates')
    .select('*, contact:contacts(first_name, phone, preferred_language)')
    .eq('id', id)
    .eq('organization_id', ctx.organizationId)
    .single()

  if (error || !estimate) {
    return NextResponse.json({ error: 'Estimate not found.' }, { status: 404 })
  }

  const { data: lineItems } = await supabase
    .from('estimate_line_items')
    .select('id, description, quantity, unit_price_cents, position')
    .eq('estimate_id', id)
    .eq('organization_id', ctx.organizationId)
    .order('position', { ascending: true })

  return NextResponse.json({ ...estimate, line_items: lineItems ?? [] })
}

// ─── PATCH /api/estimates/[id] ────────────────────────────────
// Edit a DRAFT estimate only. Recompute totals when tax/lines change.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const ctx = await resolveOrg(supabase)
  if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status })
  const { organizationId } = ctx

  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }
  const parsed = patchEstimateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  // Load current estimate (org-scoped) — need its status + tax for
  // partial recomputes.
  const { data: current, error: loadError } = await supabase
    .from('estimates')
    .select('id, status, tax_cents')
    .eq('id', id)
    .eq('organization_id', organizationId)
    .single()

  if (loadError || !current) {
    return NextResponse.json({ error: 'Estimate not found.' }, { status: 404 })
  }
  if (current.status !== 'draft') {
    return NextResponse.json({ error: 'Only draft estimates can be edited.' }, { status: 409 })
  }

  const { title, notes, tax_cents, line_items } = parsed.data
  const nextTax = tax_cents ?? current.tax_cents ?? 0

  const updates: Record<string, unknown> = {}
  if (title !== undefined) updates.title = title
  if (notes !== undefined) updates.notes = notes || null
  if (tax_cents !== undefined) updates.tax_cents = tax_cents

  // Recompute totals whenever tax or line items change.
  if (line_items !== undefined) {
    const subtotal_cents = line_items.reduce(
      (sum, li) => sum + Math.round(li.quantity * li.unit_price_cents),
      0
    )
    updates.subtotal_cents = subtotal_cents
    updates.total_cents = subtotal_cents + nextTax

    // Replace the line items wholesale — simplest correct semantics for
    // a draft edit. Delete then re-insert with fresh positions.
    await supabase
      .from('estimate_line_items')
      .delete()
      .eq('estimate_id', id)
      .eq('organization_id', organizationId)

    const rows = line_items.map((li, i) => ({
      estimate_id: id,
      organization_id: organizationId,
      description: li.description,
      quantity: li.quantity,
      unit_price_cents: li.unit_price_cents,
      position: i,
    }))
    const { error: itemsError } = await supabase.from('estimate_line_items').insert(rows)
    if (itemsError) {
      return NextResponse.json({ error: itemsError.message }, { status: 500 })
    }
  } else if (tax_cents !== undefined) {
    // Tax changed but lines didn't — recompute total from stored subtotal.
    const { data: subRow } = await supabase
      .from('estimates')
      .select('subtotal_cents')
      .eq('id', id)
      .eq('organization_id', organizationId)
      .single()
    const subtotal = subRow?.subtotal_cents ?? 0
    updates.total_cents = subtotal + nextTax
  }

  if (Object.keys(updates).length > 0) {
    const { error: updateError } = await supabase
      .from('estimates')
      .update(updates as TablesUpdate<'estimates'>)
      .eq('id', id)
      .eq('organization_id', organizationId)
      .eq('status', 'draft') // guard against a concurrent send
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }
  }

  return NextResponse.json({ id, ok: true })
}
