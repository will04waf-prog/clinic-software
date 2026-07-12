import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

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

// ─── GET /api/invoices/[id] ───────────────────────────────────
// Invoice + line items + client + payment ledger (org-scoped).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const ctx = await resolveOrg(supabase)
  if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status })

  const { data: invoice, error } = await supabase
    .from('invoices')
    .select('*, contact:contacts(first_name, phone)')
    .eq('id', id)
    .eq('organization_id', ctx.organizationId)
    .single()

  if (error || !invoice) {
    return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 })
  }

  const { data: lineItems } = await supabase
    .from('invoice_line_items')
    .select('id, description, quantity, unit_price_cents, position')
    .eq('invoice_id', id)
    .eq('organization_id', ctx.organizationId)
    .order('position', { ascending: true })

  const { data: payments } = await supabase
    .from('payments')
    .select('id, method, amount_cents, created_at')
    .eq('invoice_id', id)
    .eq('organization_id', ctx.organizationId)
    .order('created_at', { ascending: false })

  return NextResponse.json({
    ...invoice,
    line_items: lineItems ?? [],
    payments: payments ?? [],
  })
}
