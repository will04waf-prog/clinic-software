/**
 * E2E assertion for the fake-card loop: given an invoice id, print the
 * payments ledger rows + invoice status so the run can be verified.
 * Throwaway diagnostic — service-role read, no writes.
 */
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
const invoiceId = process.argv[2]
if (!url || !key || !invoiceId) throw new Error('need env + invoice id arg')

const db = createClient(url, key)

async function main() {
  const { data: invoice } = await db
    .from('invoices')
    .select('invoice_number, status, total_cents, amount_paid_cents, paid_at, organization_id')
    .eq('id', invoiceId)
    .single()

  const { data: payments } = await db
    .from('payments')
    .select('method, status, amount_cents, application_fee_cents, stripe_payment_intent, created_at')
    .eq('invoice_id', invoiceId)
    .order('created_at')

  console.log(JSON.stringify({ invoice, payments }, null, 2))
}

main()
