'use client'
import { useCallback, useEffect, useState } from 'react'
import { Plus, Trash2, CalendarX, Building2, User } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'

interface Override {
  id: string
  provider_id: string | null
  kind: 'closed' | 'custom'
  date: string // YYYY-MM-DD
  start_time: string | null
  end_time: string | null
  reason: string | null
}

interface ProviderLite {
  id: string
  display_name: string
}

interface DraftOverride {
  provider_id: string | null // null = clinic-wide
  kind: 'closed' | 'custom'
  date: string
  start_time: string
  end_time: string
  reason: string
}

const HHMM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/

function todayISO(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function ninetyDaysOutISO(): string {
  const now = new Date()
  now.setDate(now.getDate() + 90)
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function formatDate(iso: string): string {
  // iso = YYYY-MM-DD — parse as local date, not UTC
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1)
  return dt.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

interface AvailabilityOverridesCardProps {
  timezone: string | null
}

export function AvailabilityOverridesCard({ timezone }: AvailabilityOverridesCardProps) {
  const [overrides, setOverrides] = useState<Override[]>([])
  const [providers, setProviders] = useState<ProviderLite[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<DraftOverride>({
    provider_id: null,
    kind: 'closed',
    date: todayISO(),
    start_time: '09:00',
    end_time: '17:00',
    reason: '',
  })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError('')
    try {
      const from = todayISO()
      const to = ninetyDaysOutISO()
      const [oRes, pRes] = await Promise.all([
        fetch(
          `/api/booking/availability-overrides?from=${from}&to=${to}`,
          { cache: 'no-store', signal },
        ),
        fetch('/api/booking/providers', { cache: 'no-store', signal }),
      ])
      if (!oRes.ok) throw new Error('Failed to load overrides')
      if (!pRes.ok) throw new Error('Failed to load providers')
      const oJson = await oRes.json()
      const pJson = await pRes.json()
      const list: Override[] = Array.isArray(oJson.overrides) ? oJson.overrides : []
      list.sort((a, b) => a.date.localeCompare(b.date))
      setOverrides(list)
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

  function openAdd() {
    setDraft({
      provider_id: null,
      kind: 'closed',
      date: todayISO(),
      start_time: '09:00',
      end_time: '17:00',
      reason: '',
    })
    setFormError('')
    setOpen(true)
  }

  async function save() {
    if (!draft.date) {
      setFormError('Pick a date')
      return
    }
    if (draft.kind === 'custom') {
      if (!HHMM.test(draft.start_time) || !HHMM.test(draft.end_time)) {
        setFormError('Use HH:MM format')
        return
      }
      const [sh, sm] = draft.start_time.split(':').map(Number)
      const [eh, em] = draft.end_time.split(':').map(Number)
      if (eh * 60 + em <= sh * 60 + sm) {
        setFormError('End must be after start')
        return
      }
    }
    setSaving(true)
    setFormError('')
    try {
      const payload = {
        providerId: draft.provider_id,
        kind: draft.kind,
        date: draft.date,
        startTime: draft.kind === 'custom' ? draft.start_time : null,
        endTime: draft.kind === 'custom' ? draft.end_time : null,
        reason: draft.reason.trim() || null,
      }
      const res = await fetch('/api/booking/availability-overrides', {
        method: 'POST',
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
    if (!confirm('Remove this override?')) return
    try {
      const res = await fetch(
        `/api/booking/availability-overrides?id=${encodeURIComponent(id)}`,
        { method: 'DELETE' },
      )
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'Failed to remove override')
      }
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove')
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <CalendarX className="h-4 w-4 text-brand-600" />
              Time off & overrides
            </CardTitle>
            <p className="mt-1 text-sm text-gray-500">
              Holidays, vacations, and one-off custom hours. Overrides take precedence
              over the weekly schedule for that date.
            </p>
            {timezone && (
              <p className="mt-1 text-xs text-gray-400">
                Dates and times are in {timezone}.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={openAdd}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
          >
            <Plus className="h-3.5 w-3.5" />
            Add override
          </button>
        </div>
      </CardHeader>
      <CardContent className="text-sm">
        {loading ? (
          <p className="text-gray-400">Loading…</p>
        ) : error ? (
          <p className="text-red-600">{error}</p>
        ) : overrides.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center">
            <p className="text-sm font-medium text-gray-700">No overrides in the next 90 days</p>
            <p className="mt-1 text-xs text-gray-500">
              Add holidays or vacations so they're blocked off automatically.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {overrides.map((o) => {
              const prv = o.provider_id
                ? providers.find((p) => p.id === o.provider_id)
                : null
              return (
                <li
                  key={o.id}
                  className="flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-3"
                >
                  <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700">
                    {o.provider_id ? (
                      <User className="h-3.5 w-3.5" />
                    ) : (
                      <Building2 className="h-3.5 w-3.5" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-gray-900">{formatDate(o.date)}</p>
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                          o.kind === 'closed'
                            ? 'bg-red-50 text-red-700'
                            : 'bg-amber-50 text-amber-700'
                        }`}
                      >
                        {o.kind === 'closed' ? 'Closed' : 'Custom hours'}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-gray-500">
                      {prv ? prv.display_name : 'Clinic-wide'}
                      {o.kind === 'custom' && o.start_time && o.end_time && (
                        <> · {o.start_time}–{o.end_time}</>
                      )}
                      {o.reason && <> · {o.reason}</>}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => remove(o.id)}
                    className="shrink-0 rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-red-50 hover:text-red-600"
                    aria-label="Remove"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add override</DialogTitle>
            <DialogDescription>
              Block off a date or replace it with custom hours. Clinic-wide overrides
              beat everything; provider overrides apply just to that person.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 text-sm">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-600">
                Applies to
              </label>
              <select
                value={draft.provider_id ?? ''}
                onChange={(e) =>
                  setDraft({ ...draft, provider_id: e.target.value || null })
                }
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                <option value="">Clinic-wide (everyone)</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.display_name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-600">
                Kind
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setDraft({ ...draft, kind: 'closed' })}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                    draft.kind === 'closed'
                      ? 'border-brand-600 bg-brand-600 text-white'
                      : 'border-gray-200 bg-white text-gray-700 hover:border-brand-300'
                  }`}
                >
                  Closed all day
                </button>
                <button
                  type="button"
                  onClick={() => setDraft({ ...draft, kind: 'custom' })}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                    draft.kind === 'custom'
                      ? 'border-brand-600 bg-brand-600 text-white'
                      : 'border-gray-200 bg-white text-gray-700 hover:border-brand-300'
                  }`}
                >
                  Custom hours
                </button>
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-600">Date</label>
              <input
                type="date"
                value={draft.date}
                onChange={(e) => setDraft({ ...draft, date: e.target.value })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>

            {draft.kind === 'custom' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-gray-600">Start</label>
                  <input
                    type="time"
                    value={draft.start_time}
                    onChange={(e) => setDraft({ ...draft, start_time: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-gray-600">End</label>
                  <input
                    type="time"
                    value={draft.end_time}
                    onChange={(e) => setDraft({ ...draft, end_time: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-600">
                Reason (optional)
              </label>
              <input
                type="text"
                value={draft.reason}
                onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
                placeholder="Christmas, Vacation, Off-site training"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
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
                {saving ? 'Saving…' : 'Add override'}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
