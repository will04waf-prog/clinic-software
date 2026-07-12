import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

const lineItemSchema = z.object({
  description: z.string().min(1, 'Description is required').max(500),
  quantity: z.coerce.number().positive('Quantity must be greater than 0'),
  unit_price_cents: z.coerce.number().int().min(0, 'Price must be 0 or more'),
})

// Two creation modes share one endpoint:
//  • from a source  → { job_id } or { estimate_id }  (copy the estimate)
//  • direct         → { contact_id, title, tax_cents?, line_items:[…] }
// Everything is optional at the schema level; the handler enforces which
// combination is required per mode.
const createInvoiceSchema = z.object({
  job_id: z.string().uuid('Invalid job').optional(),
  estimate_id: z.string().uuid('Invalid estimate').optional(),
  contact_id: z.string().uuid('Invalid client').optional(),
  title: z.string().min(1).max(200).optional(),
  notes: z.string().max(2000).optional(),
  tax_cents: z.coerce.number().int().min(0).optional(),
  line_items: z.array(lineItemSchema).optional(),
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

// ─── GET /api/invoices ────────────────────────────────────────
// List the org's invoices, newest first, with the client's first name.
export async function GET() {
  const supabase = await createClient()
  const ctx = await resolveOrg(supabase)
  if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status })

  const { data, error } = await supabase
    .from('invoices')
    .select('id, invoice_number, status, total_cents, amount_paid_cents, title, created_at, contact:contacts(first_name)')
    .eq('organization_id', ctx.organizationId)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const normalized = (data ?? []).map((i: any) => {
    const contact = Array.isArray(i.contact) ? i.contact[0] : i.contact
    return {
      id: i.id,
      invoice_number: i.invoice_number,
      status: i.status,
      total_cents: i.total_cents,
      amount_paid_cents: i.amount_paid_cents,
      title: i.title,
      created_at: i.created_at,
      first_name: contact?.first_name ?? null,
    }
  })

  return NextResponse.json(normalized)
}

// ─── POST /api/invoices ───────────────────────────────────────
// Create a draft invoice + its line items. Either copy from an approved
// estimate (via estimate_id, or a job's estimate_id) or build it directly.
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const ctx = await resolveOrg(supabase)
  if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status })
  const { user, organizationId } = ctx

  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }
  const parsed = createInvoiceSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }
  const { job_id, estimate_id, contact_id, title, notes, line_items } = parsed.data

  // Resolved fields for the insert, populated by whichever mode runs.
  let invoiceContactId: string
  let invoiceTitle: string | null
  let subtotal_cents: number
  let tax_cents: number
  let total_cents: number
  let itemRows: { description: string; quantity: number; unit_price_cents: number }[]
  let sourceEstimateId: string | null = estimate_id ?? null
  const sourceJobId: string | null = job_id ?? null

  if (job_id || estimate_id) {
    // ── From-source mode ──────────────────────────────────────
    // For a job, the estimate is job.estimate_id.
    let resolvedEstimateId = estimate_id ?? null
    if (job_id && !resolvedEstimateId) {
      const { data: job } = await supabase
        .from('jobs')
        .select('id, estimate_id, contact_id')
        .eq('id', job_id)
        .eq('organization_id', organizationId)
        .single()
      if (!job) {
        return NextResponse.json({ error: 'Job not found.' }, { status: 404 })
      }
      if (!job.estimate_id) {
        return NextResponse.json({ error: 'This job has no estimate to invoice.' }, { status: 400 })
      }
      resolvedEstimateId = job.estimate_id as string
    }
    if (!resolvedEstimateId) {
      return NextResponse.json({ error: 'No estimate to invoice.' }, { status: 400 })
    }
    sourceEstimateId = resolvedEstimateId

    const { data: estimate } = await supabase
      .from('estimates')
      .select('id, contact_id, title, subtotal_cents, tax_cents, total_cents')
      .eq('id', resolvedEstimateId)
      .eq('organization_id', organizationId)
      .single()
    if (!estimate) {
      return NextResponse.json({ error: 'Estimate not found.' }, { status: 404 })
    }

    const { data: estimateItems } = await supabase
      .from('estimate_line_items')
      .select('description, quantity, unit_price_cents, position')
      .eq('estimate_id', resolvedEstimateId)
      .eq('organization_id', organizationId)
      .order('position', { ascending: true })

    invoiceContactId = estimate.contact_id as string
    invoiceTitle = (title ?? estimate.title) || null
    subtotal_cents = estimate.subtotal_cents ?? 0
    tax_cents = estimate.tax_cents ?? 0
    total_cents = estimate.total_cents ?? subtotal_cents + tax_cents
    itemRows = (estimateItems ?? []).map((li: any) => ({
      description: li.description,
      quantity: Number(li.quantity),
      unit_price_cents: li.unit_price_cents,
    }))
  } else {
    // ── Direct mode ───────────────────────────────────────────
    if (!contact_id) {
      return NextResponse.json({ error: 'Client is required.' }, { status: 400 })
    }
    if (!line_items || line_items.length === 0) {
      return NextResponse.json({ error: 'Add at least one line item.' }, { status: 400 })
    }

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

    // Money math in integer cents. quantity is numeric; round each product
    // so fractional quantities can't leak sub-cent totals into the DB.
    subtotal_cents = line_items.reduce(
      (sum, li) => sum + Math.round(li.quantity * li.unit_price_cents),
      0
    )
    tax_cents = parsed.data.tax_cents ?? 0
    total_cents = subtotal_cents + tax_cents
    invoiceContactId = contact_id
    invoiceTitle = title || null
    itemRows = line_items.map((li) => ({
      description: li.description,
      quantity: li.quantity,
      unit_price_cents: li.unit_price_cents,
    }))
  }

  // Sequential per-org invoice number.
  const { data: numberData, error: numberError } = await supabase.rpc('next_document_number', {
    p_org: organizationId,
    p_kind: 'invoice',
  })
  if (numberError || numberData == null) {
    return NextResponse.json(
      { error: numberError?.message ?? 'Could not assign invoice number.' },
      { status: 500 }
    )
  }
  const invoice_number = Number(numberData)

  const { data: invoice, error: insertError } = await supabase
    .from('invoices')
    .insert({
      organization_id: organizationId,
      contact_id: invoiceContactId,
      job_id: sourceJobId,
      estimate_id: sourceEstimateId,
      invoice_number,
      status: 'draft',
      title: invoiceTitle,
      notes: notes || null,
      subtotal_cents,
      tax_cents,
      total_cents,
      created_by: user.id,
    })
    .select('id, invoice_number')
    .single()

  if (insertError || !invoice) {
    return NextResponse.json(
      { error: insertError?.message ?? 'Could not create invoice.' },
      { status: 500 }
    )
  }

  if (itemRows.length > 0) {
    const rows = itemRows.map((li, i) => ({
      invoice_id: invoice.id,
      organization_id: organizationId,
      description: li.description,
      quantity: li.quantity,
      unit_price_cents: li.unit_price_cents,
      position: i,
    }))
    const { error: itemsError } = await supabase.from('invoice_line_items').insert(rows)
    if (itemsError) {
      // Roll back the header so we don't leave an invoice with no lines.
      await supabase.from('invoices').delete().eq('id', invoice.id).eq('organization_id', organizationId)
      return NextResponse.json({ error: itemsError.message }, { status: 500 })
    }
  }

  return NextResponse.json(
    { id: invoice.id, invoice_number: invoice.invoice_number },
    { status: 201 }
  )
}
