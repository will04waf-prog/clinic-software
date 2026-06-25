'use client'
import { useCallback, useEffect, useState } from 'react'
import { Plus, Pencil, Trash2, User } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'

interface Provider {
  id: string
  display_name: string
  role_label: string | null
  photo_url: string | null
  is_active: boolean
  buffer_before_min: number
  buffer_after_min: number
  profile_id: string | null
  service_ids: string[]
}

interface ServiceLite {
  id: string
  name: string
}

interface StaffLite {
  id: string
  full_name: string
}

interface DraftProvider {
  display_name: string
  role_label: string
  photo_url: string
  buffer_before_min: number
  buffer_after_min: number
  profile_id: string | null
  service_ids: string[]
}

const EMPTY_DRAFT: DraftProvider = {
  display_name: '',
  role_label: '',
  photo_url: '',
  buffer_before_min: 0,
  buffer_after_min: 15,
  profile_id: null,
  service_ids: [],
}

export function BookingProvidersCard() {
  const [providers, setProviders] = useState<Provider[]>([])
  const [services, setServices] = useState<ServiceLite[]>([])
  const [staff, setStaff] = useState<StaffLite[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<DraftProvider>(EMPTY_DRAFT)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError('')
    try {
      const [pRes, sRes, stRes] = await Promise.all([
        fetch('/api/booking/providers', { cache: 'no-store', signal }),
        fetch('/api/booking/services', { cache: 'no-store', signal }),
        fetch('/api/org/staff', { cache: 'no-store', signal }).catch(() => null),
      ])
      if (!pRes.ok) throw new Error('Failed to load providers')
      if (!sRes.ok) throw new Error('Failed to load services')
      const pJson = await pRes.json()
      const sJson = await sRes.json()
      setProviders(Array.isArray(pJson.providers) ? pJson.providers : [])
      setServices(
        (Array.isArray(sJson.services) ? sJson.services : []).map((s: any) => ({
          id: s.id,
          name: s.name,
        })),
      )
      if (stRes && stRes.ok) {
        const stJson = await stRes.json()
        setStaff(Array.isArray(stJson.staff) ? stJson.staff : [])
      }
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
    setFormError('')
    setOpen(true)
  }

  function openEdit(p: Provider) {
    setEditingId(p.id)
    setDraft({
      display_name: p.display_name,
      role_label: p.role_label ?? '',
      photo_url: p.photo_url ?? '',
      buffer_before_min: p.buffer_before_min,
      buffer_after_min: p.buffer_after_min,
      profile_id: p.profile_id,
      service_ids: p.service_ids,
    })
    setFormError('')
    setOpen(true)
  }

  async function save() {
    const name = draft.display_name.trim()
    if (!name) {
      setFormError('Display name is required')
      return
    }
    setSaving(true)
    setFormError('')
    try {
      const payload = {
        display_name: name,
        role_label: draft.role_label.trim() || null,
        photo_url: draft.photo_url.trim() || null,
        buffer_before_min: draft.buffer_before_min,
        buffer_after_min: draft.buffer_after_min,
        profile_id: draft.profile_id,
        service_ids: draft.service_ids,
      }
      const url = editingId
        ? `/api/booking/providers/${editingId}`
        : '/api/booking/providers'
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
    if (!confirm('Deactivate this provider? Past bookings stay; new bookings will not include them.')) return
    try {
      const res = await fetch(`/api/booking/providers/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'Failed to remove provider')
      }
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove')
    }
  }

  function toggleServiceInDraft(id: string) {
    setDraft((d) => ({
      ...d,
      service_ids: d.service_ids.includes(id)
        ? d.service_ids.filter((s) => s !== id)
        : [...d.service_ids, id],
    }))
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Providers</CardTitle>
            <p className="mt-1 text-sm text-gray-500">
              The people who perform consultations or services. Each booking is
              tied to one provider.
            </p>
          </div>
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
          >
            <Plus className="h-3.5 w-3.5" />
            Add provider
          </button>
        </div>
      </CardHeader>
      <CardContent className="text-sm">
        {loading ? (
          <p className="text-gray-400">Loading…</p>
        ) : error ? (
          <p className="text-red-600">{error}</p>
        ) : providers.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center">
            <p className="text-sm font-medium text-gray-700">No providers yet</p>
            <p className="mt-1 text-xs text-gray-500">
              Add the people who perform consultations or services so patients
              can book with them.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {providers.map((p) => (
              <li
                key={p.id}
                className="flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-3"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-50 text-brand-600">
                  {p.photo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.photo_url}
                      alt={p.display_name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <User className="h-5 w-5" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-gray-900">{p.display_name}</p>
                    {p.role_label && (
                      <span className="text-xs text-gray-500">·  {p.role_label}</span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-gray-500">
                    Buffer {p.buffer_before_min}m before · {p.buffer_after_min}m after
                  </p>
                  {p.service_ids.length > 0 ? (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {p.service_ids.map((sid) => {
                        const svc = services.find((s) => s.id === sid)
                        if (!svc) return null
                        return (
                          <span
                            key={sid}
                            className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700"
                          >
                            {svc.name}
                          </span>
                        )
                      })}
                    </div>
                  ) : (
                    <p className="mt-1 text-xs italic text-gray-400">
                      Not assigned to any service yet
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => openEdit(p)}
                    className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
                    aria-label="Edit"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(p.id)}
                    className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-red-50 hover:text-red-600"
                    aria-label="Remove"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit provider' : 'Add provider'}</DialogTitle>
            <DialogDescription>
              Providers are the resources patients book against — a slot exists when at
              least one assigned provider is open.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 text-sm">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-600">
                Display name
              </label>
              <input
                type="text"
                value={draft.display_name}
                onChange={(e) => setDraft({ ...draft, display_name: e.target.value })}
                placeholder="Dr. Jane Smith"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-600">
                Role label (optional)
              </label>
              <input
                type="text"
                value={draft.role_label}
                onChange={(e) => setDraft({ ...draft, role_label: e.target.value })}
                placeholder="Nurse Injector, MD, Aesthetician"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-600">
                Photo URL (optional)
              </label>
              <input
                type="url"
                value={draft.photo_url}
                onChange={(e) => setDraft({ ...draft, photo_url: e.target.value })}
                placeholder="https://…"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-600">
                  Buffer before (min)
                </label>
                <input
                  type="number"
                  min={0}
                  max={240}
                  value={draft.buffer_before_min}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      buffer_before_min: Math.max(0, Math.min(240, Number(e.target.value) || 0)),
                    })
                  }
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-600">
                  Buffer after (min)
                </label>
                <input
                  type="number"
                  min={0}
                  max={240}
                  value={draft.buffer_after_min}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      buffer_after_min: Math.max(0, Math.min(240, Number(e.target.value) || 0)),
                    })
                  }
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
            </div>

            {staff.length > 0 && (
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-600">
                  Linked staff user (optional)
                </label>
                <select
                  value={draft.profile_id ?? ''}
                  onChange={(e) =>
                    setDraft({ ...draft, profile_id: e.target.value || null })
                  }
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <option value="">— None —</option>
                  {staff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.full_name}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-gray-400">
                  Link to a staff dashboard user, or leave empty for external providers.
                </p>
              </div>
            )}

            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-600">
                Services this provider can perform
              </label>
              {services.length === 0 ? (
                <p className="text-xs italic text-gray-400">
                  Add a service first to assign it here.
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {services.map((s) => {
                    const on = draft.service_ids.includes(s.id)
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => toggleServiceInDraft(s.id)}
                        className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                          on
                            ? 'border-brand-600 bg-brand-600 text-white'
                            : 'border-gray-200 bg-white text-gray-700 hover:border-brand-300 hover:text-brand-600'
                        }`}
                      >
                        {s.name}
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
                {saving ? 'Saving…' : editingId ? 'Save changes' : 'Add provider'}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
