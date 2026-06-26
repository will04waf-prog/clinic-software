'use client'
import { useCallback, useEffect, useState } from 'react'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'

interface Service {
  id: string
  name: string
  description: string | null
  duration_min: number
  price_cents: number | null
  lead_time_hours: number
  booking_horizon_days: number
  is_active: boolean
  is_bookable_online: boolean
  color: string | null
  position: number
  provider_ids: string[]
}

interface ProviderLite {
  id: string
  display_name: string
}

interface DraftService {
  name: string
  description: string
  duration_min: number
  price_cents: number | null
  lead_time_hours: number
  booking_horizon_days: number
  is_bookable_online: boolean
  color: string | null
  provider_ids: string[]
}

const EMPTY_DRAFT: DraftService = {
  name: '',
  description: '',
  duration_min: 30,
  price_cents: null,
  lead_time_hours: 24,
  booking_horizon_days: 60,
  is_bookable_online: true,
  color: null,
  provider_ids: [],
}

const DURATION_PRESETS = [15, 30, 45, 60, 90, 120]
// Brand palette only — every preset must be in the approved set
// (#02C39A, #04B08C, #028090, #026B78, #14241D, #B5710F). The earlier
// list shipped #036b78 (typo), #7c3aed (purple), #db2777 (pink) which
// would let an owner stamp non-brand colors into calendar tiles.
const COLOR_PRESETS = ['#02C39A', '#04B08C', '#028090', '#026B78', '#14241D', '#B5710F']

function priceDollars(cents: number | null): string {
  if (cents === null) return ''
  return (cents / 100).toFixed(2)
}

function formatPrice(cents: number | null): string {
  if (cents === null) return 'No price shown'
  return `$${(cents / 100).toFixed(2)}`
}

export function BookingServicesCard() {
  const [services, setServices] = useState<Service[]>([])
  const [providers, setProviders] = useState<ProviderLite[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // "Delete" is a soft-delete (sets is_active=false) — hide inactive
  // rows by default so delete reads as expected. See parallel comment
  // in booking-providers-card.tsx.
  const [showInactive, setShowInactive] = useState(false)
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<DraftService>(EMPTY_DRAFT)
  const [priceInput, setPriceInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError('')
    try {
      const [sRes, pRes] = await Promise.all([
        fetch('/api/booking/services', { cache: 'no-store', signal }),
        fetch('/api/booking/providers', { cache: 'no-store', signal }),
      ])
      if (!sRes.ok) throw new Error('Failed to load services')
      if (!pRes.ok) throw new Error('Failed to load providers')
      const sJson = await sRes.json()
      const pJson = await pRes.json()
      setServices(Array.isArray(sJson.services) ? sJson.services : [])
      setProviders(
        (Array.isArray(pJson.providers) ? pJson.providers : []).map((p: any) => ({
          id: p.id,
          display_name: p.display_name,
        })),
      )
    } catch (err: unknown) {
      if ((err as any)?.name === 'AbortError') return
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const ctrl = new AbortController()
    load(ctrl.signal)
    return () => ctrl.abort()
  }, [load])

  function openCreate() {
    setEditingId(null)
    setDraft(EMPTY_DRAFT)
    setPriceInput('')
    setFormError('')
    setOpen(true)
  }

  function openEdit(s: Service) {
    setEditingId(s.id)
    setDraft({
      name: s.name,
      description: s.description ?? '',
      duration_min: s.duration_min,
      price_cents: s.price_cents,
      lead_time_hours: s.lead_time_hours,
      booking_horizon_days: s.booking_horizon_days,
      is_bookable_online: s.is_bookable_online,
      color: s.color,
      provider_ids: s.provider_ids,
    })
    setPriceInput(priceDollars(s.price_cents))
    setFormError('')
    setOpen(true)
  }

  function commitPriceInput(raw: string) {
    const trimmed = raw.trim()
    if (!trimmed) {
      setDraft((d) => ({ ...d, price_cents: null }))
      return
    }
    const num = Number(trimmed)
    if (!Number.isFinite(num) || num < 0) return
    setDraft((d) => ({ ...d, price_cents: Math.round(num * 100) }))
  }

  async function save() {
    const name = draft.name.trim()
    if (!name) {
      setFormError('Service name is required')
      return
    }
    if (draft.duration_min < 5 || draft.duration_min > 480) {
      setFormError('Duration must be 5–480 minutes')
      return
    }
    setSaving(true)
    setFormError('')
    try {
      const payload = {
        name,
        description: draft.description.trim() || null,
        duration_min: draft.duration_min,
        price_cents: draft.price_cents,
        lead_time_hours: draft.lead_time_hours,
        booking_horizon_days: draft.booking_horizon_days,
        is_bookable_online: draft.is_bookable_online,
        color: draft.color,
        provider_ids: draft.provider_ids,
      }
      const url = editingId
        ? `/api/booking/services/${editingId}`
        : '/api/booking/services'
      const res = await fetch(url, {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'Failed to save')
      }
      setOpen(false)
      await load()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string) {
    if (!confirm('Deactivate this service? Past bookings stay; it will no longer appear when patients book.')) return
    try {
      const res = await fetch(`/api/booking/services/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'Failed to remove service')
      }
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove')
    }
  }

  function toggleProviderInDraft(id: string) {
    setDraft((d) => ({
      ...d,
      provider_ids: d.provider_ids.includes(id)
        ? d.provider_ids.filter((p) => p !== id)
        : [...d.provider_ids, id],
    }))
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Services</CardTitle>
            <p className="mt-1 text-sm text-gray-500">
              The appointments patients can book — like "Botox consult — 30 min".
            </p>
          </div>
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
          >
            <Plus className="h-3.5 w-3.5" />
            Add service
          </button>
        </div>
      </CardHeader>
      <CardContent className="text-sm">
        {loading ? (
          <p className="text-gray-400">Loading…</p>
        ) : error ? (
          <p className="text-red-600">{error}</p>
        ) : (() => {
          const visibleServices = showInactive ? services : services.filter((s) => s.is_active)
          const inactiveCount = services.filter((s) => !s.is_active).length
          if (visibleServices.length === 0 && inactiveCount === 0) {
            return (
              <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center">
                <p className="text-sm font-medium text-gray-700">No services yet</p>
                <p className="mt-1 text-xs text-gray-500">
                  Add the appointments patients can book — like "Botox consult — 30 min".
                </p>
              </div>
            )
          }
          return (
            <>
          <ul className="space-y-2">
            {visibleServices.map((s) => (
              <li
                key={s.id}
                className={`flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-3 ${
                  s.is_active ? '' : 'opacity-60'
                }`}
              >
                <div
                  className="mt-1 h-3 w-3 shrink-0 rounded-full"
                  style={{ backgroundColor: s.color ?? '#02C39A' }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-gray-900">{s.name}</p>
                    <span className="text-xs text-gray-500">{s.duration_min} min</span>
                    <span className="text-xs text-gray-500">·  {formatPrice(s.price_cents)}</span>
                    {!s.is_bookable_online && (
                      <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600">
                        Not online
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-gray-500">
                    Lead time {s.lead_time_hours}h · book up to {s.booking_horizon_days} days out
                  </p>
                  {s.provider_ids.length > 0 ? (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {s.provider_ids.map((pid) => {
                        const prv = providers.find((p) => p.id === pid)
                        if (!prv) return null
                        return (
                          <span
                            key={pid}
                            className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700"
                          >
                            {prv.display_name}
                          </span>
                        )
                      })}
                    </div>
                  ) : (
                    <p className="mt-1 text-xs italic text-gray-400">
                      No providers assigned — not yet bookable
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => openEdit(s)}
                    className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
                    aria-label="Edit"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(s.id)}
                    className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-red-50 hover:text-red-600"
                    aria-label="Remove"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {inactiveCount > 0 && (
            <button
              type="button"
              onClick={() => setShowInactive((v) => !v)}
              className="mt-3 text-xs font-medium text-gray-500 hover:text-gray-700"
            >
              {showInactive
                ? `Hide ${inactiveCount} inactive`
                : `+${inactiveCount} inactive — show`}
            </button>
          )}
            </>
          )
        })()}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit service' : 'Add service'}</DialogTitle>
            <DialogDescription>
              Services are the bookable units patients pick. Duration is copied to
              the booking at insert time, so editing later won't move past bookings.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 text-sm">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-600">
                Service name
              </label>
              <input
                type="text"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Botox consult — 30 min"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-600">
                Description (optional)
              </label>
              <textarea
                rows={2}
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                placeholder="Short description shown to patients on the booking page"
                className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-600">
                Duration
              </label>
              <div className="flex flex-wrap gap-1.5">
                {DURATION_PRESETS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDraft({ ...draft, duration_min: d })}
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                      draft.duration_min === d
                        ? 'border-brand-600 bg-brand-600 text-white'
                        : 'border-gray-200 bg-white text-gray-700 hover:border-brand-300 hover:text-brand-600'
                    }`}
                  >
                    {d} min
                  </button>
                ))}
                <input
                  type="number"
                  min={5}
                  max={480}
                  value={draft.duration_min}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      duration_min: Math.max(5, Math.min(480, Number(e.target.value) || 5)),
                    })
                  }
                  className="w-20 rounded-full border border-gray-300 px-3 py-1 text-xs focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-600">
                  Price (USD, optional)
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={priceInput}
                  onChange={(e) => {
                    setPriceInput(e.target.value)
                    commitPriceInput(e.target.value)
                  }}
                  placeholder="0.00"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
                <p className="mt-1 text-xs text-gray-400">
                  Leave blank to hide price from the booking page.
                </p>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-600">
                  Color
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {COLOR_PRESETS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setDraft({ ...draft, color: c })}
                      className={`h-7 w-7 rounded-full border-2 transition-transform ${
                        draft.color === c ? 'border-gray-900 scale-110' : 'border-white shadow-sm'
                      }`}
                      style={{ backgroundColor: c }}
                      aria-label={c}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-600">
                  Lead time (hours)
                </label>
                <input
                  type="number"
                  min={0}
                  max={720}
                  value={draft.lead_time_hours}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      lead_time_hours: Math.max(0, Math.min(720, Number(e.target.value) || 0)),
                    })
                  }
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
                <p className="mt-1 text-xs text-gray-400">Minimum notice before a booking.</p>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-600">
                  Booking horizon (days)
                </label>
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={draft.booking_horizon_days}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      booking_horizon_days: Math.max(1, Math.min(365, Number(e.target.value) || 1)),
                    })
                  }
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
                <p className="mt-1 text-xs text-gray-400">How far out patients can book.</p>
              </div>
            </div>

            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.is_bookable_online}
                onChange={(e) =>
                  setDraft({ ...draft, is_bookable_online: e.target.checked })
                }
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
              />
              <span>
                <span className="font-medium text-gray-900">Bookable online</span>
                <span className="block text-xs text-gray-500">
                  Off = hidden from the public booking page but still usable for manual consultations.
                </span>
              </span>
            </label>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-600">
                Providers who can perform this service
              </label>
              {providers.length === 0 ? (
                <p className="text-xs italic text-gray-400">
                  Add a provider first to assign them here.
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {providers.map((p) => {
                    const on = draft.provider_ids.includes(p.id)
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => toggleProviderInDraft(p.id)}
                        className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                          on
                            ? 'border-brand-600 bg-brand-600 text-white'
                            : 'border-gray-200 bg-white text-gray-700 hover:border-brand-300 hover:text-brand-600'
                        }`}
                      >
                        {p.display_name}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {formError && <p className="text-sm text-red-600">{formError}</p>}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:bg-brand-400"
              >
                {saving ? 'Saving…' : editingId ? 'Save changes' : 'Add service'}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
