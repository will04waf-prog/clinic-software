/**
 * GET /api/export/tax-package?year=YYYY&file=invoices|payments|clients|summary
 *
 * The WS-D #2 pick: a tax-time packet for the owner's accountant —
 * deliberately CSV, deliberately NOT a live QuickBooks sync (incumbents'
 * two-way syncs corrupt books; the real user here is a storefront tax
 * preparer who ingests CSV into whatever they run). Four files instead
 * of a ZIP keeps this dependency-free; the settings card offers all
 * four as separate downloads.
 *
 * Owner-only. Headers follow the owner's language — the summary file is
 * titled "Reporte para su contador" and groups income by month and by
 * payment method, which is exactly the reconstruction a preparer
 * otherwise does by scrolling a bank app.
 *
 * Money note: amounts export as decimal dollars (14.50), computed from
 * cents — accountants live in spreadsheets, not integer cents.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireRole, isDenied, OWNER_ONLY } from '@/lib/auth/roles'

const FILES = ['invoices', 'payments', 'clients', 'summary'] as const
type FileKind = (typeof FILES)[number]

const dollars = (cents: number | null | undefined) => ((cents ?? 0) / 100).toFixed(2)

/** RFC-4180 quoting: wrap when the value carries a comma/quote/newline. */
function csvCell(v: string | number | null | undefined): string {
  const s = v == null ? '' : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const csvRow = (cells: Array<string | number | null | undefined>) => cells.map(csvCell).join(',')

function csvResponse(filename: string, rows: string[]): NextResponse {
  // BOM so Excel opens UTF-8 (accents in names/notes) correctly.
  const body = '﻿' + rows.join('\r\n') + '\r\n'
  return new NextResponse(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await requireRole(supabase, user.id, OWNER_ONLY)
  if (isDenied(gate)) return gate.response

  const url = new URL(req.url)
  const year = Number(url.searchParams.get('year'))
  const file = url.searchParams.get('file') as FileKind | null
  const thisYear = new Date().getUTCFullYear()
  if (!Number.isInteger(year) || year < 2020 || year > thisYear) {
    return NextResponse.json({ error: 'invalid_year' }, { status: 400 })
  }
  if (!file || !FILES.includes(file)) {
    return NextResponse.json({ error: 'invalid_file' }, { status: 400 })
  }

  const { data: org } = await supabase
    .from('organizations')
    .select('name, owner_language')
    .eq('id', gate.orgId)
    .single()
  const es = org?.owner_language !== 'en'
  const orgName = org?.name ?? 'Tarhunna'

  const from = `${year}-01-01T00:00:00Z`
  const to = `${year + 1}-01-01T00:00:00Z`

  if (file === 'clients') {
    const { data, error } = await supabase
      .from('contacts')
      .select('first_name, last_name, phone, email, created_at')
      .eq('organization_id', gate.orgId)
      .eq('is_archived', false)
      .order('created_at', { ascending: true })
    if (error) return NextResponse.json({ error: 'query_failed' }, { status: 500 })
    const rows = [
      csvRow(es ? ['Nombre', 'Apellido', 'Teléfono', 'Correo', 'Cliente desde'] : ['First name', 'Last name', 'Phone', 'Email', 'Customer since']),
      ...(data ?? []).map(c => csvRow([c.first_name, c.last_name, c.phone, c.email, (c.created_at ?? '').slice(0, 10)])),
    ]
    return csvResponse(`${es ? 'clientes' : 'clients'}-${year}.csv`, rows)
  }

  if (file === 'invoices') {
    const { data, error } = await supabase
      .from('invoices')
      .select('invoice_number, title, status, subtotal_cents, tax_cents, total_cents, amount_paid_cents, created_at, paid_at, contact:contacts(first_name, last_name)')
      .eq('organization_id', gate.orgId)
      .gte('created_at', from)
      .lt('created_at', to)
      .order('invoice_number', { ascending: true })
    if (error) return NextResponse.json({ error: 'query_failed' }, { status: 500 })
    const rows = [
      csvRow(es
        ? ['Factura #', 'Fecha', 'Cliente', 'Descripción', 'Estado', 'Subtotal', 'Impuesto', 'Total', 'Pagado', 'Fecha de pago']
        : ['Invoice #', 'Date', 'Customer', 'Description', 'Status', 'Subtotal', 'Tax', 'Total', 'Paid', 'Paid on']),
      ...(data ?? []).map((i: any) => {
        const c = Array.isArray(i.contact) ? i.contact[0] : i.contact
        const name = [c?.first_name, c?.last_name].filter(Boolean).join(' ')
        return csvRow([
          i.invoice_number, (i.created_at ?? '').slice(0, 10), name, i.title, i.status,
          dollars(i.subtotal_cents), dollars(i.tax_cents), dollars(i.total_cents),
          dollars(i.amount_paid_cents), (i.paid_at ?? '').slice(0, 10),
        ])
      }),
    ]
    return csvResponse(`${es ? 'facturas' : 'invoices'}-${year}.csv`, rows)
  }

  if (file === 'payments') {
    const { data, error } = await supabase
      .from('payments')
      .select('amount_cents, method, status, note, created_at, invoice:invoices(invoice_number, contact:contacts(first_name, last_name))')
      .eq('organization_id', gate.orgId)
      .gte('created_at', from)
      .lt('created_at', to)
      .order('created_at', { ascending: true })
    if (error) return NextResponse.json({ error: 'query_failed' }, { status: 500 })
    const rows = [
      csvRow(es
        ? ['Fecha', 'Monto', 'Método', 'Estado', 'Factura #', 'Cliente', 'Nota']
        : ['Date', 'Amount', 'Method', 'Status', 'Invoice #', 'Customer', 'Note']),
      ...(data ?? []).map((p: any) => {
        const inv = Array.isArray(p.invoice) ? p.invoice[0] : p.invoice
        const c = inv ? (Array.isArray(inv.contact) ? inv.contact[0] : inv.contact) : null
        const name = [c?.first_name, c?.last_name].filter(Boolean).join(' ')
        return csvRow([
          (p.created_at ?? '').slice(0, 10), dollars(p.amount_cents), p.method, p.status,
          inv?.invoice_number ?? '', name, p.note,
        ])
      }),
    ]
    return csvResponse(`${es ? 'pagos' : 'payments'}-${year}.csv`, rows)
  }

  // summary — income grouped by month and by payment method.
  const { data: pays, error } = await supabase
    .from('payments')
    .select('amount_cents, method, status, created_at')
    .eq('organization_id', gate.orgId)
    .gte('created_at', from)
    .lt('created_at', to)
  if (error) return NextResponse.json({ error: 'query_failed' }, { status: 500 })

  const byMonth = new Map<string, number>()
  const byMethod = new Map<string, number>()
  let total = 0
  for (const p of pays ?? []) {
    if (p.status === 'refunded' || p.status === 'failed') continue
    const cents = p.amount_cents ?? 0
    total += cents
    const month = (p.created_at ?? '').slice(0, 7)
    byMonth.set(month, (byMonth.get(month) ?? 0) + cents)
    byMethod.set(p.method ?? '?', (byMethod.get(p.method ?? '?') ?? 0) + cents)
  }

  const monthNamesEs = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
  const monthNamesEn = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  const rows: string[] = [
    csvRow([es ? `Reporte para su contador — ${orgName}` : `Report for your accountant — ${orgName}`]),
    csvRow([es ? `Año ${year} · ingresos cobrados (pagos registrados)` : `Year ${year} · collected income (recorded payments)`]),
    '',
    csvRow([es ? 'Ingresos por mes' : 'Income by month']),
    csvRow([es ? 'Mes' : 'Month', es ? 'Monto' : 'Amount']),
  ]
  for (let m = 0; m < 12; m++) {
    const key = `${year}-${String(m + 1).padStart(2, '0')}`
    rows.push(csvRow([(es ? monthNamesEs : monthNamesEn)[m], dollars(byMonth.get(key) ?? 0)]))
  }
  rows.push('', csvRow([es ? 'Ingresos por método de pago' : 'Income by payment method']), csvRow([es ? 'Método' : 'Method', es ? 'Monto' : 'Amount']))
  for (const [method, cents] of [...byMethod.entries()].sort((a, b) => b[1] - a[1])) {
    rows.push(csvRow([method, dollars(cents)]))
  }
  rows.push('', csvRow([es ? 'TOTAL DEL AÑO' : 'YEAR TOTAL', dollars(total)]))

  return csvResponse(`${es ? 'reporte-contador' : 'accountant-report'}-${year}.csv`, rows)
}
