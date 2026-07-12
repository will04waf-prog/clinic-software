'use client'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Plus, Trash2, ArrowLeft, Check, Send, Copy } from 'lucide-react'
import { dict, type Locale } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

export type ClientOption = { id: string; first_name: string; phone: string | null }

type LineRow = { description: string; qty: string; price: string }

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

export function EstimateBuilder({
  locale,
  initialClients,
}: {
  locale: Locale
  initialClients: ClientOption[]
}) {
  const router = useRouter()
  const m = dict(locale).estimate
  const c = dict(locale).clients
  const common = dict(locale).common

  const [clients, setClients] = useState<ClientOption[]>(initialClients)
  const [clientId, setClientId] = useState<string>('')

  // Inline new-client mini-form.
  const [showNewClient, setShowNewClient] = useState(initialClients.length === 0)
  const [ncName, setNcName] = useState('')
  const [ncPhone, setNcPhone] = useState('')
  const [ncSaving, setNcSaving] = useState(false)
  const [ncError, setNcError] = useState<string | null>(null)

  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [tax, setTax] = useState('')
  const [lines, setLines] = useState<LineRow[]>([emptyLine()])

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<{ id: string; estimate_number: number } | null>(null)

  const [sending, setSending] = useState(false)
  const [sendResult, setSendResult] = useState<{ channel: string; link: string } | null>(null)
  const [copied, setCopied] = useState(false)

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

  async function createClientInline() {
    setNcError(null)
    if (!ncName.trim() || !ncPhone.trim()) {
      setNcError(common.required)
      return
    }
    setNcSaving(true)
    try {
      const res = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: ncName.trim(),
          phone: ncPhone.trim(),
          preferred_language: locale,
        }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setNcError(body?.error ?? 'Error')
        return
      }
      const newClient: ClientOption = { id: body.id, first_name: body.first_name, phone: body.phone }
      setClients((prev) => [newClient, ...prev])
      setClientId(newClient.id)
      setShowNewClient(false)
      setNcName('')
      setNcPhone('')
    } catch {
      setNcError('Error')
    } finally {
      setNcSaving(false)
    }
  }

  async function saveDraft() {
    setError(null)
    if (!clientId) {
      setError(m.errNoClient)
      return
    }
    const validLines = lines.filter((l) => l.description.trim() && qtyOf(l.qty) > 0)
    if (validLines.length === 0) {
      setError(m.errNoLines)
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/estimates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact_id: clientId,
          title: title.trim() || m.jobTitlePlaceholder,
          tax_cents: taxCents,
          notes: notes.trim() || undefined,
          line_items: validLines.map((l) => ({
            description: l.description.trim(),
            quantity: qtyOf(l.qty),
            unit_price_cents: dollarsToCents(l.price),
          })),
        }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setError(body?.error ?? 'Error')
        return
      }
      setSaved({ id: body.id, estimate_number: body.estimate_number })
    } catch {
      setError('Error')
    } finally {
      setSaving(false)
    }
  }

  // Send route is owned by the OTHER agent — we only call it.
  async function sendEstimate() {
    if (!saved) return
    setError(null)
    setSending(true)
    try {
      const res = await fetch(`/api/estimates/${saved.id}/send`, { method: 'POST' })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setError(body?.error ?? 'Error')
        return
      }
      setSendResult({ channel: body.channel ?? 'none', link: body.link ?? '' })
    } catch {
      setError('Error')
    } finally {
      setSending(false)
    }
  }

  const selectedClient = clients.find((x) => x.id === clientId) ?? null

  // ─── Success screen ─────────────────────────────────────────
  if (saved) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 pt-6 pb-28">
        <div className="rounded-2xl border border-[#02C39A]/30 bg-[#02C39A]/10 p-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[#02C39A] text-white">
            <Check className="h-6 w-6" />
          </div>
          <h1 className="text-lg font-semibold text-[#0B2027]">{m.number(saved.estimate_number)}</h1>
          <p className="mt-1 text-sm text-gray-600">${money(totalCents)}</p>

          {!sendResult && (
            <Button className="mt-5 w-full" onClick={sendEstimate} disabled={sending}>
              <Send className="h-4 w-4" />
              {sending ? m.sending : m.send}
            </Button>
          )}

          {sendResult && (
            <div className="mt-5 rounded-xl border border-gray-200 bg-white p-4 text-left">
              <p className="text-sm font-medium text-[#0B2027]">
                {selectedClient ? m.sentToast(selectedClient.first_name) : m.statusSent}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                {sendResult.channel === 'whatsapp' ? m.sentWhatsApp : sendResult.channel === 'sms' ? m.sentSms : m.shareLink}
              </p>
              {sendResult.link && (
                <div className="mt-3 flex items-center gap-2">
                  <input
                    readOnly
                    value={sendResult.link}
                    className="flex-1 truncate rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => {
                      navigator.clipboard?.writeText(sendResult.link).then(
                        () => { setCopied(true); setTimeout(() => setCopied(false), 1500) },
                        () => {}
                      )
                    }}
                  >
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              )}
            </div>
          )}

          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

          <Button asChild variant="ghost" className="mt-4 w-full">
            <Link href="/estimates">{common.back}</Link>
          </Button>
        </div>
      </div>
    )
  }

  // ─── Builder form ───────────────────────────────────────────
  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-6 pb-28">
      <div className="mb-5 flex items-center gap-2">
        <Button asChild variant="ghost" size="icon" className="h-11 w-11">
          <Link href="/estimates" aria-label={common.back}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <h1 className="text-xl font-semibold text-[#0B2027]">{m.newTitle}</h1>
      </div>

      <div className="space-y-5">
        {/* Client picker */}
        <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <Label className="mb-2 block">{m.forClient}</Label>
          {!showNewClient && (
            <div className="flex gap-2">
              <select
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                className="flex h-11 w-full min-w-0 rounded-lg border border-gray-200 bg-white px-3 text-base text-gray-900 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                <option value="">{c.pick}</option>
                {clients.map((cl) => (
                  <option key={cl.id} value={cl.id}>
                    {cl.first_name}{cl.phone ? ` · ${cl.phone}` : ''}
                  </option>
                ))}
              </select>
              <Button type="button" variant="outline" size="sm" onClick={() => setShowNewClient(true)}>
                <Plus className="h-4 w-4" />
                {c.newClient}
              </Button>
            </div>
          )}

          {showNewClient && (
            <div className="space-y-3">
              <div>
                <Label htmlFor="nc-name" className="mb-1 block text-xs">{c.name}</Label>
                <Input
                  id="nc-name"
                  value={ncName}
                  onChange={(e) => setNcName(e.target.value)}
                  placeholder={c.namePlaceholder}
                />
              </div>
              <div>
                <Label htmlFor="nc-phone" className="mb-1 block text-xs">{c.phone}</Label>
                <Input
                  id="nc-phone"
                  type="tel"
                  inputMode="tel"
                  value={ncPhone}
                  onChange={(e) => setNcPhone(e.target.value)}
                  placeholder={c.phonePlaceholder}
                />
              </div>
              {ncError && <p className="text-xs text-red-600">{ncError}</p>}
              <div className="flex gap-2">
                <Button type="button" size="sm" onClick={createClientInline} disabled={ncSaving}>
                  {ncSaving ? common.saving : c.save}
                </Button>
                {clients.length > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => { setShowNewClient(false); setNcError(null) }}
                  >
                    {common.cancel}
                  </Button>
                )}
              </div>
            </div>
          )}
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
                    className="h-11 w-11 text-gray-400 hover:text-red-600"
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

        {error && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}

        <Button className="w-full" size="lg" onClick={saveDraft} disabled={saving}>
          {saving ? common.saving : m.saveDraft}
        </Button>
      </div>
    </div>
  )
}
