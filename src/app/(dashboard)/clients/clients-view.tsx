'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Plus, UserPlus, Phone, FileText, MessageCircle } from 'lucide-react'
import { dict, type Locale } from '@/lib/i18n'

export interface ClientRow {
  id: string
  first_name: string
  phone: string
}

// Mobile-first clients screen: add form on top (the #1 job on this
// screen), then the list. Server pre-loads rows, so there is no
// loading state; errors surface in the form in the owner's language.
export function ClientsView({ locale, initialClients }: { locale: Locale; initialClients: ClientRow[] }) {
  const c = dict(locale).clients
  const s = dict(locale).signup

  const [rows, setRows] = useState<ClientRow[]>(initialClients)
  const [showForm, setShowForm] = useState(initialClients.length === 0)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    setError('')
    if (!name.trim()) { setError(s.errOwnerName); return }
    if (!phone.trim()) { setError(s.errPhone); return }
    setSaving(true)
    try {
      const res = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ first_name: name.trim(), phone: phone.trim(), preferred_language: locale }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok || !body?.id) {
        setError(body?.error === 'Invalid phone number.' ? s.errPhoneFormat : (body?.error ?? s.errGeneric))
        return
      }
      setRows((prev) => [{ id: body.id, first_name: body.first_name, phone: body.phone ?? '' }, ...prev])
      setName('')
      setPhone('')
      setShowForm(false)
    } catch {
      setError(s.errGeneric)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 pb-28">
      <div className="mb-5 flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-[#0B2027]">{c.title}</h1>
        {!showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-gradient-brand px-4 text-sm font-semibold text-white active:scale-[.99]"
          >
            <Plus className="h-4 w-4" /> {c.add}
          </button>
        )}
      </div>

      {showForm && (
        <div className="mb-6 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#0B2027]">
            <UserPlus className="h-4 w-4 text-[#028090]" /> {c.newClient}
          </p>
          <label className="mb-1 block text-xs text-gray-500">{c.name}</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={c.namePlaceholder}
            className="mb-3 h-12 w-full rounded-xl border border-gray-200 bg-white px-3 text-base text-gray-900 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          />
          <label className="mb-1 block text-xs text-gray-500">{c.phone}</label>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder={c.phonePlaceholder}
            inputMode="tel"
            className="mb-3 h-12 w-full rounded-xl border border-gray-200 bg-white px-3 text-base text-gray-900 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          />
          {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="inline-flex min-h-12 flex-1 items-center justify-center rounded-xl bg-gradient-brand px-5 text-base font-semibold text-white active:scale-[.99] disabled:opacity-60"
            >
              {saving ? dict(locale).common.saving : c.save}
            </button>
            {rows.length > 0 && (
              <button
                type="button"
                onClick={() => { setShowForm(false); setError('') }}
                className="inline-flex min-h-12 items-center justify-center rounded-xl border border-gray-200 bg-white px-5 text-base font-medium text-gray-600 active:scale-[.99]"
              >
                {dict(locale).common.cancel}
              </button>
            )}
          </div>
        </div>
      )}

      {rows.length === 0 && !showForm ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white/60 px-6 py-10 text-center">
          <UserPlus className="mx-auto mb-3 h-8 w-8 text-gray-300" />
          <p className="text-sm text-gray-500">{c.empty}</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3.5 shadow-sm">
              {/* Name/phone area opens the client's WhatsApp thread. */}
              <Link href={`/clients/${r.id}`} className="min-w-0 flex-1">
                <p className="truncate text-base font-medium text-gray-900">{r.first_name}</p>
                {r.phone && (
                  <p className="mt-0.5 flex items-center gap-1.5 text-sm text-gray-500">
                    <Phone className="h-3.5 w-3.5" /> {r.phone}
                  </p>
                )}
              </Link>
              <Link
                href={`/clients/${r.id}`}
                aria-label={dict(locale).inbox.title}
                className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl border border-[#02C39A]/40 bg-[#02C39A]/10 px-3.5 text-sm font-medium text-[#0B7A5E] active:scale-[.99]"
              >
                <MessageCircle className="h-4 w-4" /> {dict(locale).inbox.title}
              </Link>
              <Link
                href="/estimates/new"
                className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl border border-[#028090]/30 bg-[#028090]/5 px-3.5 text-sm font-medium text-[#028090] active:scale-[.99]"
              >
                <FileText className="h-4 w-4" /> {dict(locale).dashboard.newEstimate}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
