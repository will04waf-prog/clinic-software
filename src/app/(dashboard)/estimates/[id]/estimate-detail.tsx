'use client'

import { useState } from 'react'
import Link from 'next/link'
import { dict, type Locale } from '@/lib/i18n'
import { ArrowLeft, Send, Check, Copy, ExternalLink } from 'lucide-react'

export interface EstimateDetailData {
  id: string
  estimateNumber: number
  status: string
  title: string
  clientName: string
  subtotalCents: number
  taxCents: number
  totalCents: number
  notes: string
  lineItems: { id: string; description: string; quantity: number; unitPriceCents: number }[]
}

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`

function statusLabel(status: string, t: ReturnType<typeof dict>['estimate']): string {
  switch (status) {
    case 'draft': return t.statusDraft
    case 'sent': return t.statusSent
    case 'viewed': return t.statusViewed
    case 'approved': return t.statusApproved
    default: return status
  }
}

export function EstimateDetail({ locale, estimate }: { locale: Locale; estimate: EstimateDetailData }) {
  const t = dict(locale).estimate
  const c = dict(locale).common
  const [status, setStatus] = useState(estimate.status)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ link: string; channel: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')

  const approved = status === 'approved'
  const canSend = status === 'draft' || status === 'sent' || status === 'viewed'

  async function send() {
    setSending(true)
    setError('')
    try {
      const res = await fetch(`/api/estimates/${estimate.id}/send`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setError(j.error ?? c.loading); return }
      setResult({ link: j.link, channel: j.channel })
      if (status === 'draft') setStatus('sent')
    } catch {
      setError(t.errNoClient)
    } finally {
      setSending(false)
    }
  }

  async function copyLink() {
    if (!result?.link) return
    try {
      await navigator.clipboard.writeText(result.link)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch { /* clipboard blocked — link is visible to copy manually */ }
  }

  const pillClass = approved
    ? 'bg-[#02C39A]/15 text-[#028090]'
    : status === 'draft'
      ? 'bg-gray-100 text-gray-500'
      : 'bg-[#028090]/10 text-[#028090]'

  return (
    <div className="mx-auto w-full max-w-md px-4 pt-6 pb-28">
      <Link href="/estimates" className="mb-3 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
        <ArrowLeft className="h-4 w-4" /> {t.empty ? 'Estimados' : ''}
      </Link>

      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{t.number(estimate.estimateNumber)}</h1>
          <p className="text-sm text-gray-500">{t.forClient} {estimate.clientName}</p>
        </div>
        <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${pillClass}`}>
          {statusLabel(status, t)}
        </span>
      </div>

      {estimate.title && <p className="mt-3 font-medium text-gray-800">{estimate.title}</p>}

      {/* Line items */}
      <div className="mt-4 rounded-2xl border border-gray-200 bg-white shadow-sm divide-y divide-gray-100">
        {estimate.lineItems.map((li) => (
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
          <Row label={t.subtotal} value={money(estimate.subtotalCents)} />
          {estimate.taxCents > 0 && <Row label={t.tax} value={money(estimate.taxCents)} />}
          <Row label={t.total} value={money(estimate.totalCents)} bold />
        </div>
      </div>

      {estimate.notes && <p className="mt-3 text-sm text-gray-500">{estimate.notes}</p>}

      {/* Send / share */}
      {approved ? (
        <div className="mt-5 flex items-center gap-2 rounded-xl bg-[#02C39A]/10 px-4 py-3 text-sm font-medium text-[#028090]">
          <Check className="h-4 w-4" /> {t.statusApproved}
        </div>
      ) : (
        <div className="mt-5 space-y-3">
          {canSend && (
            <button
              type="button"
              onClick={send}
              disabled={sending}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-brand px-5 py-3.5 text-base font-semibold text-white active:scale-[.99] transition-transform disabled:opacity-60"
            >
              <Send className="h-4 w-4" />
              {sending ? t.sending : t.send}
            </button>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
          {result && (
            <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
              <p className="text-xs text-gray-500">
                {result.channel === 'whatsapp' ? t.sentWhatsApp : result.channel === 'sms' ? t.sentSms : t.shareLink}
              </p>
              <div className="mt-1 flex items-center gap-2">
                <input readOnly value={result.link} className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs text-gray-700" />
                <button type="button" onClick={copyLink} className="shrink-0 rounded-lg border border-gray-200 p-2 text-gray-600 hover:bg-gray-50" aria-label="Copiar">
                  {copied ? <Check className="h-4 w-4 text-[#028090]" /> : <Copy className="h-4 w-4" />}
                </button>
                <a href={result.link} target="_blank" rel="noopener noreferrer" className="shrink-0 rounded-lg border border-gray-200 p-2 text-gray-600 hover:bg-gray-50" aria-label="Abrir">
                  <ExternalLink className="h-4 w-4" />
                </a>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className={`text-sm ${bold ? 'font-semibold text-gray-900' : 'text-gray-500'}`}>{label}</span>
      <span className={`tabular-nums ${bold ? 'text-base font-bold text-gray-900' : 'text-sm text-gray-700'}`}>{value}</span>
    </div>
  )
}
