'use client'

import { useState } from 'react'
import Link from 'next/link'
import { dict, type Locale } from '@/lib/i18n'
import { ArrowLeft, Check, Banknote, Smartphone, FileText, MoreHorizontal } from 'lucide-react'

type PaymentMethod = 'cash' | 'zelle' | 'check' | 'other'

export interface InvoiceDetailData {
  id: string
  invoiceNumber: number
  status: string
  title: string
  clientName: string
  subtotalCents: number
  taxCents: number
  totalCents: number
  amountPaidCents: number
  notes: string
  lineItems: { id: string; description: string; quantity: number; unitPriceCents: number }[]
  payments: { id: string; method: PaymentMethod; amountCents: number; createdAt: string }[]
}

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`

function statusLabel(status: string, t: ReturnType<typeof dict>['invoice']): string {
  switch (status) {
    case 'draft': return t.statusDraft
    case 'sent':  return t.statusSent
    case 'paid':  return t.statusPaid
    case 'void':  return t.statusVoid
    default:      return status
  }
}

function methodLabel(method: PaymentMethod, t: ReturnType<typeof dict>['invoice']): string {
  switch (method) {
    case 'cash':  return t.methodCash
    case 'zelle': return t.methodZelle
    case 'check': return t.methodCheck
    default:      return t.methodOther
  }
}

const METHODS: { key: PaymentMethod; icon: typeof Banknote }[] = [
  { key: 'cash', icon: Banknote },
  { key: 'zelle', icon: Smartphone },
  { key: 'check', icon: FileText },
  { key: 'other', icon: MoreHorizontal },
]

export function InvoiceDetail({ locale, invoice }: { locale: Locale; invoice: InvoiceDetailData }) {
  const t = dict(locale).invoice
  const c = dict(locale).common

  const [status, setStatus] = useState(invoice.status)
  const [amountPaid, setAmountPaid] = useState(invoice.amountPaidCents)
  const [payments, setPayments] = useState(invoice.payments)

  const balance = Math.max(0, invoice.totalCents - amountPaid)
  const isPaid = status === 'paid' || balance === 0

  // Record-payment form
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [amount, setAmount] = useState<string>((balance / 100).toFixed(2))
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const pillClass = isPaid
    ? 'bg-[#02C39A]/15 text-[#0B7A5E]'
    : status === 'draft'
      ? 'bg-amber-100 text-amber-800'
      : 'bg-[#028090]/10 text-[#028090]'

  async function recordPayment() {
    setError('')
    const cents = Math.round(parseFloat(amount) * 100)
    if (!isFinite(cents) || cents <= 0) {
      setError(t.errAmount)
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/invoices/${invoice.id}/record-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method, amount_cents: cents, note: note.trim() || undefined }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setError(body?.error ?? c.loading)
        return
      }
      // Reflect the new ledger + status in place.
      setStatus(body.status)
      setAmountPaid(body.amount_paid_cents)
      setPayments((prev) => [
        { id: `local-${Date.now()}`, method, amountCents: cents, createdAt: new Date().toISOString() },
        ...prev,
      ])
      const newBalance = Math.max(0, invoice.totalCents - body.amount_paid_cents)
      setAmount((newBalance / 100).toFixed(2))
      setNote('')
    } catch {
      setError(c.loading)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-md px-4 py-6">
      <Link href="/invoices" className="mb-3 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
        <ArrowLeft className="h-4 w-4" /> {dict(locale).nav.invoices}
      </Link>

      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{t.number(invoice.invoiceNumber)}</h1>
          {invoice.clientName && (
            <p className="text-sm text-gray-500">{t.forClient} {invoice.clientName}</p>
          )}
        </div>
        <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${pillClass}`}>
          {statusLabel(status, t)}
        </span>
      </div>

      {invoice.title && <p className="mt-3 font-medium text-gray-800">{invoice.title}</p>}

      {/* Line items + totals */}
      <div className="mt-4 rounded-2xl border border-gray-200 bg-white shadow-sm divide-y divide-gray-100">
        {invoice.lineItems.map((li) => (
          <div key={li.id} className="flex items-baseline justify-between gap-3 px-4 py-3">
            <span className="min-w-0 flex-1 text-sm text-gray-800">
              {li.description}
              {li.quantity !== 1 && <span className="text-gray-400"> × {li.quantity}</span>}
            </span>
            <span className="shrink-0 text-sm font-medium tabular-nums text-gray-900">
              {money(li.unitPriceCents * li.quantity)}
            </span>
          </div>
        ))}
        <div className="px-4 py-3 space-y-1">
          <Row label={t.subtotal} value={money(invoice.subtotalCents)} />
          {invoice.taxCents > 0 && <Row label={t.tax} value={money(invoice.taxCents)} />}
          <Row label={t.total} value={money(invoice.totalCents)} bold />
          {amountPaid > 0 && <Row label={t.amountPaid} value={`− ${money(amountPaid)}`} />}
          <Row label={t.balance} value={money(balance)} bold accent={!isPaid} />
        </div>
      </div>

      {invoice.notes && <p className="mt-3 text-sm text-gray-500">{invoice.notes}</p>}

      {/* Record payment / paid-in-full */}
      {isPaid ? (
        <div className="mt-5 flex items-center gap-2 rounded-xl bg-[#02C39A]/10 px-4 py-3 text-sm font-medium text-[#0B7A5E]">
          <Check className="h-4 w-4" /> {t.paidInFull}
        </div>
      ) : (
        <div className="mt-5 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-sm font-semibold text-[#14241d]">{t.recordPayment}</p>
          <p className="mb-3 mt-0.5 text-[11px] text-gray-400">{t.feeNote}</p>

          {/* Method chips */}
          <div className="grid grid-cols-4 gap-2">
            {METHODS.map(({ key, icon: Icon }) => {
              const active = method === key
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setMethod(key)}
                  className={`flex flex-col items-center justify-center gap-1 rounded-xl border px-2 py-2.5 text-[11px] font-medium transition-colors ${
                    active
                      ? 'border-[#028090] bg-[#028090]/10 text-[#028090]'
                      : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {methodLabel(key, t)}
                </button>
              )
            })}
          </div>

          {/* Amount (defaults to the balance) */}
          <div className="mt-3">
            <label className="mb-1 block text-xs text-gray-500">{t.amount}</label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">$</span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="h-10 w-full rounded-lg border border-gray-200 bg-white pl-6 pr-3 text-sm tabular-nums text-gray-900 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              />
            </div>
          </div>

          {/* Optional note */}
          <div className="mt-3">
            <label className="mb-1 block text-xs text-gray-500">{t.paymentNote}</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            />
          </div>

          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

          <button
            type="button"
            onClick={recordPayment}
            disabled={saving}
            className="mt-4 w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-brand px-5 py-3.5 text-base font-semibold text-white active:scale-[.99] transition-transform disabled:opacity-60"
          >
            {saving ? t.savingPayment : t.savePayment}
          </button>
        </div>
      )}

      {/* Existing payments ledger */}
      <div className="mt-5">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">{t.payments}</p>
        {payments.length === 0 ? (
          <p className="text-sm text-gray-500">{t.noPayments}</p>
        ) : (
          <ul className="space-y-2">
            {payments.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 py-2.5 shadow-sm"
              >
                <span className="text-sm text-gray-700">{methodLabel(p.method, t)}</span>
                <span className="text-sm font-semibold tabular-nums text-[#0B7A5E]">{money(p.amountCents)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function Row({ label, value, bold, accent }: { label: string; value: string; bold?: boolean; accent?: boolean }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className={`text-sm ${bold ? 'font-semibold text-gray-900' : 'text-gray-500'}`}>{label}</span>
      <span
        className={`tabular-nums ${
          accent ? 'text-base font-bold text-[#028090]' : bold ? 'text-base font-bold text-gray-900' : 'text-sm text-gray-700'
        }`}
      >
        {value}
      </span>
    </div>
  )
}
