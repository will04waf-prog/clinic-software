import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { z } from 'zod'
import { dbErrorResponse } from '@/lib/api/db-error'

// Manual (non-card) payments only. The card path is Stripe and lives
// elsewhere; here the owner marks cash / Zelle / check / other.
const recordPaymentSchema = z.object({
  method: z.enum(['cash', 'zelle', 'check', 'other']),
  amount_cents: z.coerce.number().int().positive('Amount must be greater than 0'),
  note: z.string().max(500).optional(),
  // Client-minted per record-attempt. A double-submit (retry, multi-tab)
  // reuses the same key → the DB's partial-unique index rejects the dup
  // and we treat it as already-recorded instead of double-counting.
  idempotency_key: z.string().uuid().optional(),
})

// Postgres unique-violation.
const UNIQUE_VIOLATION = '23505'

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

// ─── POST /api/invoices/[id]/record-payment ───────────────────
// Append a succeeded payment to the ledger (service-role, since payments
// is append-only for authenticated), recompute amount_paid_cents, and
// flip the invoice to 'paid' once the balance is covered.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const ctx = await resolveOrg(supabase)
  if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status })
  const { user, organizationId } = ctx

  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }
  const parsed = recordPaymentSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }
  const { method, amount_cents, note, idempotency_key } = parsed.data

  // Verify the invoice is in the caller's org (RLS-scoped read).
  const { data: invoice } = await supabase
    .from('invoices')
    .select('id, total_cents, status')
    .eq('id', id)
    .eq('organization_id', organizationId)
    .single()
  if (!invoice) {
    return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 })
  }

  // Append the payment via service-role (authenticated cannot INSERT).
  // A duplicate submit with the same idempotency_key hits the partial-
  // unique index (23505) — that's not an error, it means this exact
  // payment is already in the ledger. Fall through to recompute + return
  // the current state rather than double-counting.
  const { error: payError } = await supabaseAdmin.from('payments').insert({
    organization_id: organizationId,
    invoice_id: id,
    amount_cents,
    method,
    status: 'succeeded',
    note: note || null,
    created_by: user.id,
    idempotency_key: idempotency_key ?? null,
  })
  if (payError && payError.code !== UNIQUE_VIOLATION) {
    return dbErrorResponse('record-payment', payError, { status: 500 })
  }

  // Recompute amount_paid_cents from the succeeded ledger rows.
  const { data: succeeded, error: sumError } = await supabaseAdmin
    .from('payments')
    .select('amount_cents')
    .eq('invoice_id', id)
    .eq('organization_id', organizationId)
    .eq('status', 'succeeded')
  if (sumError) {
    return dbErrorResponse('record-payment', sumError, { status: 500 })
  }
  const amount_paid_cents = (succeeded ?? []).reduce(
    (sum, p: any) => sum + (p.amount_cents ?? 0),
    0
  )

  const nowPaid = amount_paid_cents >= (invoice.total_cents ?? 0)
  const update: Record<string, unknown> = { amount_paid_cents }
  if (nowPaid) {
    update.status = 'paid'
    update.paid_at = new Date().toISOString()
  }

  const { data: updated, error: updateError } = await supabaseAdmin
    .from('invoices')
    .update(update)
    .eq('id', id)
    .eq('organization_id', organizationId)
    .select('status, amount_paid_cents')
    .single()
  if (updateError || !updated) {
    return dbErrorResponse('record-payment', updateError, { status: 500 })
  }

  return NextResponse.json({
    status: updated.status,
    amount_paid_cents: updated.amount_paid_cents,
  })
}
