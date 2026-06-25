'use client'
import { useCallback, useEffect, useState } from 'react'
import { Plus, X, Copy, Clock } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface Rule {
  weekday: number
  startTime: string
  endTime: string
}

interface ProviderLite {
  id: string
  display_name: string
}

const WEEKDAYS: Array<{ idx: number; short: string; full: string }> = [
  { idx: 0, short: 'Sun', full: 'Sunday' },
  { idx: 1, short: 'Mon', full: 'Monday' },
  { idx: 2, short: 'Tue', full: 'Tuesday' },
  { idx: 3, short: 'Wed', full: 'Wednesday' },
  { idx: 4, short: 'Thu', full: 'Thursday' },
  { idx: 5, short: 'Fri', full: 'Friday' },
  { idx: 6, short: 'Sat', full: 'Saturday' },
]

const HHMM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/

interface Props {
  timezone: string | null
}

export function ProviderWeeklyHoursCard({ timezone }: Props) {
  const [providers, setProviders] = useState<ProviderLite[]>([])
  const [providerId, setProviderId] = useState<string>('')
  const [rules, setRules] = useState<Rule[]>([])
  const [loading, setLoading] = useState(true)
  const [rulesLoading, setRulesLoading] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [dirty, setDirty] = useState(false)

  // Per-day add-range form state
  const [addingDay, setAddingDay] = useState<number | null>(null)
  const [draftStart, setDraftStart] = useState('09:00')
  const [draftEnd, setDraftEnd] = useState('17:00')
  const [addError, setAddError] = useState('')

  // Load providers once
  useEffect(() => {
    const ctrl = new AbortController()
    ;(async () => {
      setLoading(true)
      setError('')
      try {
        const res = await fetch('/api/booking/providers', {
          cache: 'no-store',
          signal: ctrl.signal,
        })
        if (!res.ok) throw new Error('Failed to load providers')
        const json = await res.json()
        const list: ProviderLite[] = (Array.isArray(json.providers) ? json.providers : []).map(
          (p: any) => ({ id: p.id, display_name: p.display_name }),
        )
        setProviders(list)
        if (list.length > 0) setProviderId(list[0].id)
      } catch (err: unknown) {
        if ((err as any)?.name === 'AbortError') return
        setError(err instanceof Error ? err.message : 'Failed to load')
      } finally {
        setLoading(false)
      }
    })()
    return () => ctrl.abort()
  }, [])

  // Load rules whenever provider changes
  const loadRules = useCallback(async (pid: string, signal?: AbortSignal) => {
    setRulesLoading(true)
    setError('')
    try {
      const res = await fetch(
        `/api/booking/availability-rules?providerId=${encodeURIComponent(pid)}`,
        { cache: 'no-store', signal },
      )
      if (!res.ok) throw new Error('Failed to load weekly hours')
      const json = await res.json()
      const fetched: Rule[] = (Array.isArray(json.rules) ? json.rules : []).map((r: any) => ({
        weekday: Number(r.weekday),
        startTime: String(r.start_time ?? r.startTime ?? '').slice(0, 5),
        endTime: String(r.end_time ?? r.endTime ?? '').slice(0, 5),
      }))
      setRules(fetched)
      setDirty(false)
      setSaved(false)
    } catch (err: unknown) {
      if ((err as any)?.name === 'AbortError') return
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setRulesLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!providerId) return
    const ctrl = new AbortController()
    loadRules(providerId, ctrl.signal)
    return () => ctrl.abort()
  }, [providerId, loadRules])

  function timeToMin(t: string): number {
    const [h, m] = t.split(':').map(Number)
    return h * 60 + m
  }

  function openAdd(day: number) {
    setAddingDay(day)
    setDraftStart('09:00')
    setDraftEnd('17:00')
    setAddError('')
  }

  function cancelAdd() {
    setAddingDay(null)
    setAddError('')
  }

  function commitAdd() {
    if (addingDay === null) return
    if (!HHMM.test(draftStart) || !HHMM.test(draftEnd)) {
      setAddError('Use HH:MM format (e.g. 09:00)')
      return
    }
    if (timeToMin(draftEnd) <= timeToMin(draftStart)) {
      setAddError('End must be after start')
      return
    }
    // Optional warning for overlap inside same weekday — not blocking
    setRules((prev) => [
      ...prev,
      { weekday: addingDay, startTime: draftStart, endTime: draftEnd },
    ])
    setDirty(true)
    setSaved(false)
    setAddingDay(null)
    setAddError('')
  }

  function removeRule(weekday: number, idx: number) {
    setRules((prev) => {
      let count = -1
      return prev.filter((r) => {
        if (r.weekday !== weekday) return true
        count += 1
        return count !== idx
      })
    })
    setDirty(true)
    setSaved(false)
  }

  function copyMondayToWeekdays() {
    const mon = rules.filter((r) => r.weekday === 1)
    if (mon.length === 0) return
    setRules((prev) => {
      // Keep weekend rules + Monday (kept already retains weekday===1
      // because the filter is `< 2`). Tue..Fri get Monday's ranges
      // expanded. The original code re-appended `...mon` here, which
      // doubled every Monday rule on each click.
      const kept = prev.filter((r) => r.weekday < 2 || r.weekday > 5)
      const expanded: Rule[] = []
      for (let d = 2; d <= 5; d += 1) {
        for (const r of mon) {
          expanded.push({ weekday: d, startTime: r.startTime, endTime: r.endTime })
        }
      }
      return [...kept, ...expanded]
    })
    setDirty(true)
    setSaved(false)
  }

  async function save() {
    if (!providerId) return
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      const res = await fetch('/api/booking/availability-rules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerId,
          rules: rules.map((r) => ({
            weekday: r.weekday,
            startTime: r.startTime,
            endTime: r.endTime,
          })),
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'Failed to save')
      }
      setSaved(true)
      setDirty(false)
      setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const rulesByDay = WEEKDAYS.map((d) => ({
    ...d,
    list: rules
      .filter((r) => r.weekday === d.idx)
      .sort((a, b) => timeToMin(a.startTime) - timeToMin(b.startTime)),
  }))

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-brand-600" />
          Weekly hours
        </CardTitle>
        <p className="mt-1 text-sm text-gray-500">
          Set when each provider is available, week after week. Add multiple ranges
          per day to model lunch breaks or split shifts.
        </p>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {loading ? (
          <p className="text-gray-400">Loading…</p>
        ) : providers.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center">
            <p className="text-sm font-medium text-gray-700">No providers yet</p>
            <p className="mt-1 text-xs text-gray-500">
              Add a provider above to set their weekly hours.
            </p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-[12rem] flex-1">
                <label className="mb-1.5 block text-xs font-medium text-gray-600">
                  Provider
                </label>
                <select
                  value={providerId}
                  onChange={(e) => setProviderId(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.display_name}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={copyMondayToWeekdays}
                disabled={rules.filter((r) => r.weekday === 1).length === 0}
                className="inline-flex items-center gap-1.5 self-end rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                <Copy className="h-3.5 w-3.5" />
                Copy Monday to weekdays
              </button>
            </div>

            <p className="text-xs text-gray-500">
              Hours are in{' '}
              <span className="font-mono font-semibold text-gray-700">
                {timezone ?? '—'}
              </span>
              {' '}— change in Clinic settings.
            </p>

            {rulesLoading ? (
              <p className="text-gray-400">Loading hours…</p>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-7">
                {rulesByDay.map((day) => (
                  <div
                    key={day.idx}
                    className="rounded-lg border border-gray-200 bg-white p-2.5"
                  >
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                      {day.short}
                    </p>
                    <div className="space-y-1.5">
                      {day.list.length === 0 && (
                        <p className="text-[11px] italic text-gray-400">Closed</p>
                      )}
                      {day.list.map((r, i) => (
                        <div
                          key={`${r.startTime}-${r.endTime}-${i}`}
                          className="flex items-center justify-between gap-1 rounded-md bg-brand-50 px-2 py-1 text-[11px] font-medium text-brand-700"
                        >
                          <span>
                            {r.startTime}–{r.endTime}
                          </span>
                          <button
                            type="button"
                            onClick={() => removeRule(day.idx, i)}
                            className="text-brand-500 hover:text-brand-700"
                            aria-label="Remove range"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                      {addingDay === day.idx ? (
                        // Stack vertically so each time input gets the full
                        // card width — the native browser time picker needs
                        // ~80px minimum, which the previous side-by-side
                        // layout clipped in the 7-column grid.
                        <div className="space-y-1.5 rounded-md border border-gray-200 p-2">
                          <div className="space-y-1">
                            <label className="block text-[10px] font-medium uppercase tracking-wider text-gray-500">
                              From
                            </label>
                            <input
                              type="time"
                              value={draftStart}
                              onChange={(e) => setDraftStart(e.target.value)}
                              className="w-full rounded border border-gray-300 px-1.5 py-1 text-[12px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="block text-[10px] font-medium uppercase tracking-wider text-gray-500">
                              To
                            </label>
                            <input
                              type="time"
                              value={draftEnd}
                              onChange={(e) => setDraftEnd(e.target.value)}
                              className="w-full rounded border border-gray-300 px-1.5 py-1 text-[12px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                            />
                          </div>
                          {addError && (
                            <p className="text-[10px] text-red-600">{addError}</p>
                          )}
                          <div className="flex gap-1 pt-0.5">
                            <button
                              type="button"
                              onClick={commitAdd}
                              className="flex-1 rounded bg-brand-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-brand-700"
                            >
                              Add
                            </button>
                            <button
                              type="button"
                              onClick={cancelAdd}
                              className="rounded border border-gray-200 px-2 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-50"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => openAdd(day.idx)}
                          className="inline-flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-gray-200 px-2 py-1 text-[11px] font-medium text-gray-500 transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
                        >
                          <Plus className="h-3 w-3" />
                          Add range
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="flex items-center gap-3 pt-1">
              <button
                type="button"
                onClick={save}
                disabled={saving || !dirty}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:bg-brand-400"
              >
                {saving ? 'Saving…' : saved ? 'Saved' : 'Save weekly hours'}
              </button>
              {dirty && !saving && (
                <span className="text-xs text-gray-500">Unsaved changes</span>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
