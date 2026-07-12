'use client'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Plus, Trash2, ArrowLeft, FileCheck, PencilLine } from 'lucide-react'
import { dict, type Locale } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

export type ClientOption = { id: string; first_name: string; phone: string | null }
export type EstimateOption = {
  id: string
  estimate_number: number
  title: string
  total_cents: number
  first_name: string | null
}

type LineRow = { description: string; qty: string; price: string }
type Mode = 'estimate' | 'scratch'

const emptyLine = (): LineRow => ({ description: '', qty: '1', price: '' })

// Parse a user-typed dollar string into integer cents. Non-numeric → 0.
function dollarsToCents(raw: string): number {
  const n = parseFloat(raw)
  if (!isFinite(n) || n < 0) return 0
  return Math.round(n * 100)
}
function qtyOf(raw: string): number {
  const n = parseFloat(raw)
  return isFinite(n) && n > 0 ? n : 0
}
function money(cents: number): string {
  return (cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function InvoiceBuilder({
  locale,
  initialClients,
  approvedEstimates,
}: {
  locale: Locale
  initialClients: ClientOption[]
  approvedEstimates: EstimateOption[]
}) {
  const router = useRouter()
  const m = dict(locale).invoice
  const c = dict(locale).clients
  const est = dict(locale).estimate
  const common = dict(locale).common

  const hasEstimates = approvedEstimates.length > 0
  const [mode, setMode] = useState<Mode>(hasEstimates ? 'estimate' : 'scratch')

  // Estimate mode
  const [estimateId, setEstimateId] = useState<string>('')

  // Direct mode
  const [clientId, setClientId] = useState<string>('')
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [tax, setTax] = useState('')
  const [lines, setLines] = useState<LineRow[]>([emptyLine()])

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const subtotalCents = useMemo(
    () => lines.reduce((s, l) => s + Math.round(qtyOf(l.qty) * dollarsToCents(l.price)), 0),
    [lines]
  )
  const taxCents = dollarsToCents(tax)
  const totalCents = subtotalCents + taxCents

  function updateLine(i: number, patch: Partial<LineRow>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))
  }
  function addLine() {
    setLines((prev) => [...prev, emptyLine()])
  }
  function removeLine(i: number) {
    setLines((prev) => (prev.length === 1 ? prev : prev.filter((_, idx) => idx !== i)))
  }

  async function save() {
    setError(null)

    let payload: Record<string, unknown>
    if (mode === 'estimate') {
      if (!estimateId) {
        setError(m.pickEstimate)
        return
      }
      payload = { estimate_id: estimateId }
    } else {
      if (!clientId) {
        setError(m.errNoClient)
        return
      }
      const validLines = lines.filter((l) => l.description.trim() && qtyOf(l.qty) > 0)
      if (validLines.length === 0) {
        setError(m.errNoLines)
        return
      }
      payload = {
        contact_id: clientId,
        title: title.trim() || m.jobTitlePlaceholder,
        tax_cents: taxCents,
        notes: notes.trim() || undefined,
        line_items: validLines.map((l) => ({
          description: l.description.trim(),
          quantity: qtyOf(l.qty),
          unit_price_cents: dollarsToCents(l.price),
        })),
      }
    }

    setSaving(true)
    try {
      const res = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setError(body?.error ?? 'Error')
        return
      }
      router.push(`/invoices/${body.id}`)
    } catch {
      setError('Error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-6 pb-28">
      <div className="mb-5 flex items-center gap-2">
        <Button asChild variant="ghost" size="icon" className="h-11 w-11">
          <Link href="/invoices" aria-label={common.back}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <h1 className="text-xl font-semibold text-[#0B2027]">{m.newTitle}</h1>
      </div>

      {/* Mode toggle — only shown when there is an estimate path to offer. */}
      {hasEstimates && (
        <div className="mb-5 grid grid-cols-2 gap-2 rounded-xl bg-gray-100 p-1">
          <button
            type="button"
            onClick={() => { setMode('estimate'); setError(null) }}
            className={`flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              mode === 'estimate' ? 'bg-white text-[#028090] shadow-sm' : 'text-gray-500'
            }`}
          >
            <FileCheck className="h-4 w-4" />
            {m.fromEstimate}
          </button>
          <button
            type="button"
            onClick={() => { setMode('scratch'); setError(null) }}
            className={`flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              mode === 'scratch' ? 'bg-white text-[#028090] shadow-sm' : 'text-gray-500'
            }`}
          >
            <PencilLine className="h-4 w-4" />
            {m.fromScratch}
          </button>
        </div>
      )}

      <div className="space-y-5">
        {mode === 'estimate' ? (
          <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <Label className="mb-2 block">{m.pickEstimate}</Label>
            {hasEstimates ? (
              <select
                value={estimateId}
                onChange={(e) => setEstimateId(e.target.value)}
                className="flex h-11 w-full min-w-0 rounded-lg border border-gray-200 bg-white px-3 text-base text-gray-900 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                <option value="">{m.pickEstimate}</option>
                {approvedEstimates.map((e) => (
                  <option key={e.id} value={e.id}>
                    {est.number(e.estimate_number)}
                    {e.first_name ? ` · ${e.first_name}` : ''} · ${money(e.total_cents)}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-sm text-gray-500">{m.noApprovedEstimates}</p>
            )}
            {estimateId && (
              <p className="mt-3 text-xs text-gray-500">
                {approvedEstimates.find((e) => e.id === estimateId)?.title}
              </p>
            )}
          </section>
        ) : (
          <>
            {/* Client picker */}
            <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <Label className="mb-2 block">{m.forClient}</Label>
              <select
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                className="flex h-11 w-full min-w-0 rounded-lg border border-gray-200 bg-white px-3 text-base text-gray-900 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                <option value="">{c.pick}</option>
                {initialClients.map((cl) => (
                  <option key={cl.id} value={cl.id}>
                    {cl.first_name}{cl.phone ? ` · ${cl.phone}` : ''}
                  </option>
                ))}
              </select>
            </section>

            {/* Job title */}
            <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <Label htmlFor="job-title" className="mb-2 block">{m.jobTitle}</Label>
              <Input
                id="job-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={m.jobTitlePlaceholder}
              />
            </section>

            {/* Line items */}
            <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <Label className="mb-3 block">{m.lineItems}</Label>
              <div className="space-y-3">
                {lines.map((l, i) => (
                  <div key={i} className="rounded-lg border border-gray-100 bg-gray-50/50 p-3">
                    <Input
                      value={l.description}
                      onChange={(e) => updateLine(i, { description: e.target.value })}
                      placeholder={m.itemDescriptionPlaceholder}
                      aria-label={m.itemDescription}
                      className="mb-2 h-11 bg-white text-base"
                    />
                    <div className="flex items-end gap-2">
                      <div className="w-16">
                        <Label className="mb-1 block text-[11px] text-gray-500">{m.qty}</Label>
                        <Input
                          type="number"
                          inputMode="decimal"
                          min="0"
                          step="any"
                          value={l.qty}
                          onChange={(e) => updateLine(i, { qty: e.target.value })}
                          className="h-11 bg-white text-base"
                        />
                      </div>
                      <div className="flex-1">
                        <Label className="mb-1 block text-[11px] text-gray-500">{m.price}</Label>
                        <div className="relative">
                          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">$</span>
                          <Input
                            type="number"
                            inputMode="decimal"
                            min="0"
                            step="0.01"
                            value={l.price}
                            onChange={(e) => updateLine(i, { price: e.target.value })}
                            placeholder="0.00"
                            className="h-11 bg-white pl-6 text-base"
                          />
                        </div>
                      </div>
                      <div className="w-20 text-right">
                        <Label className="mb-1 block text-[11px] text-gray-500">{m.total}</Label>
                        <p className="h-9 pt-2 text-sm font-medium tabular-nums text-[#0B2027]">
                          ${money(Math.round(qtyOf(l.qty) * dollarsToCents(l.price)))}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeLine(i)}
                        disabled={lines.length === 1}
                        aria-label={m.removeLine}
                        className="text-gray-400 hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
              <Button type="button" variant="outline" size="sm" onClick={addLine} className="mt-3">
                <Plus className="h-4 w-4" />
                {m.addLine}
              </Button>
            </section>

            {/* Totals */}
            <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between py-1 text-sm">
                <span className="text-gray-600">{m.subtotal}</span>
                <span className="font-medium tabular-nums text-[#0B2027]">${money(subtotalCents)}</span>
              </div>
              <div className="flex items-center justify-between gap-3 py-1 text-sm">
                <span className="text-gray-600">{m.tax}</span>
                <div className="relative w-28">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">$</span>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    value={tax}
                    onChange={(e) => setTax(e.target.value)}
                    placeholder="0.00"
                    className="pl-6 text-right"
                    aria-label={m.tax}
                  />
                </div>
              </div>
              <div className="mt-2 flex items-center justify-between border-t border-gray-100 pt-3">
                <span className="text-base font-semibold text-[#0B2027]">{m.total}</span>
                <span className="text-lg font-bold tabular-nums text-[#028090]">${money(totalCents)}</span>
              </div>
            </section>

            {/* Notes */}
            <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <Label htmlFor="notes" className="mb-2 block">{m.notes}</Label>
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={m.notesPlaceholder}
              />
            </section>
          </>
        )}

        {error && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}

        <Button className="w-full" size="lg" onClick={save} disabled={saving}>
          {saving ? m.saving : m.save}
        </Button>
      </div>
    </div>
  )
}
