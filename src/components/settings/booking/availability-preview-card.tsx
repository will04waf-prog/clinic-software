'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarCheck, RefreshCcw } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface ServiceLite {
  id: string
  name: string
  duration_min: number
  provider_ids: string[]
}

interface ProviderLite {
  id: string
  display_name: string
}

interface Slot {
  startUtc: string
  endUtc: string
  providerIds: string[]
}

interface Props {
  timezone: string | null
}

function todayISO(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function plusDaysISO(days: number): string {
  const now = new Date()
  now.setDate(now.getDate() + days)
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// Build an ISO datetime for the start of a YYYY-MM-DD in the clinic timezone.
// Using a naive new Date(iso) treats it as UTC midnight, but the API window
// is generous enough on either side that this is fine for a preview surface.
function isoStartOfDayUtc(dateIso: string): string {
  return new Date(`${dateIso}T00:00:00Z`).toISOString()
}

function isoEndOfDayUtc(dateIso: string): string {
  // End of day plus a 24h cushion so a slot landing on the boundary in any
  // reasonable timezone still falls in the window.
  return new Date(`${dateIso}T23:59:59Z`).toISOString()
}

export function AvailabilityPreviewCard({ timezone }: Props) {
  const [services, setServices] = useState<ServiceLite[]>([])
  const [providers, setProviders] = useState<ProviderLite[]>([])
  const [serviceId, setServiceId] = useState<string>('')
  const [fromDate, setFromDate] = useState<string>(todayISO())
  const [toDate, setToDate] = useState<string>(plusDaysISO(7))

  const [loadingMeta, setLoadingMeta] = useState(true)
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [error, setError] = useState('')
  const [slots, setSlots] = useState<Slot[]>([])
  const [hasRun, setHasRun] = useState(false)

  // Load services + providers once for the dropdowns.
  useEffect(() => {
    const ctrl = new AbortController()
    ;(async () => {
      setLoadingMeta(true)
      setError('')
      try {
        const [sRes, pRes] = await Promise.all([
          fetch('/api/booking/services', { cache: 'no-store', signal: ctrl.signal }),
          fetch('/api/booking/providers', { cache: 'no-store', signal: ctrl.signal }),
        ])
        if (!sRes.ok) throw new Error('Failed to load services')
        if (!pRes.ok) throw new Error('Failed to load providers')
        const sJson = await sRes.json()
        const pJson = await pRes.json()
        const svcs: ServiceLite[] = (Array.isArray(sJson.services) ? sJson.services : []).map(
          (s: any) => ({
            id: s.id,
            name: s.name,
            duration_min: s.duration_min,
            provider_ids: Array.isArray(s.provider_ids) ? s.provider_ids : [],
          }),
        )
        setServices(svcs)
        setProviders(
          (Array.isArray(pJson.providers) ? pJson.providers : []).map((p: any) => ({
            id: p.id,
            display_name: p.display_name,
          })),
        )
        if (svcs.length > 0) setServiceId(svcs[0].id)
      } catch (err: unknown) {
        if ((err as any)?.name === 'AbortError') return
        setError(err instanceof Error ? err.message : 'Failed to load')
      } finally {
        setLoadingMeta(false)
      }
    })()
    return () => ctrl.abort()
  }, [])

  const runPreview = useCallback(
    async (signal?: AbortSignal) => {
      if (!serviceId) return
      setLoadingSlots(true)
      setError('')
      setHasRun(true)
      try {
        const params = new URLSearchParams({
          serviceId,
          from: isoStartOfDayUtc(fromDate),
          to: isoEndOfDayUtc(toDate),
        })
        const res = await fetch(`/api/booking/availability?${params.toString()}`, {
          cache: 'no-store',
          signal,
        })
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          throw new Error(j.error || 'Failed to load availability')
        }
        const json = await res.json()
        setSlots(Array.isArray(json.slots) ? json.slots : [])
      } catch (err: unknown) {
        if ((err as any)?.name === 'AbortError') return
        setError(err instanceof Error ? err.message : 'Failed to load availability')
        setSlots([])
      } finally {
        setLoadingSlots(false)
      }
    },
    [serviceId, fromDate, toDate],
  )

  // Group slots by clinic-local date string.
  const grouped = useMemo(() => {
    if (!timezone) return [] as Array<{ dateLabel: string; items: Slot[] }>
    const tz = timezone
    const dayFmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    const headerFmt = new Intl.DateTimeFormat(undefined, {
      timeZone: tz,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    })
    const map = new Map<string, { label: string; items: Slot[] }>()
    for (const s of slots) {
      const start = new Date(s.startUtc)
      const key = dayFmt.format(start) // YYYY-MM-DD
      const label = headerFmt.format(start)
      const bucket = map.get(key)
      if (bucket) bucket.items.push(s)
      else map.set(key, { label, items: [s] })
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, v]) => ({ dateLabel: v.label, items: v.items }))
  }, [slots, timezone])

  const timeFmt = useMemo(() => {
    if (!timezone) return null
    return new Intl.DateTimeFormat(undefined, {
      timeZone: timezone,
      hour: 'numeric',
      minute: '2-digit',
    })
  }, [timezone])

  const selectedService = services.find((s) => s.id === serviceId) ?? null
  const noProvidersForService =
    selectedService !== null && selectedService.provider_ids.length === 0

  // Directive empty-state messaging.
  const setupHint = (() => {
    if (loadingMeta) return null
    if (services.length === 0) {
      return 'Add a service to preview availability.'
    }
    if (providers.length === 0) {
      return 'Add a provider to preview availability.'
    }
    if (noProvidersForService) {
      return 'This service has no providers assigned. Assign one in the Services card to see slots.'
    }
    return null
  })()

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarCheck className="h-4 w-4 text-brand-600" />
          Availability preview
        </CardTitle>
        <p className="mt-1 text-sm text-gray-500">
          The same engine the public booking page will use. Pick a service and a date range
          to see exactly what patients will see.
        </p>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {loadingMeta ? (
          <p className="text-gray-400">Loading…</p>
        ) : setupHint ? (
          <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center">
            <p className="text-sm font-medium text-gray-700">Nothing to preview yet</p>
            <p className="mt-1 text-xs text-gray-500">{setupHint}</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_auto_auto]">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-600">
                  Service
                </label>
                <select
                  value={serviceId}
                  onChange={(e) => {
                    setServiceId(e.target.value)
                    setHasRun(false)
                  }}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  {services.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.duration_min} min)
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-600">From</label>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => {
                    setFromDate(e.target.value)
                    setHasRun(false)
                  }}
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-600">To</label>
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => {
                    setToDate(e.target.value)
                    setHasRun(false)
                  }}
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => runPreview()}
                  disabled={loadingSlots || !serviceId || fromDate > toDate}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:bg-brand-400"
                >
                  <RefreshCcw className={`h-3.5 w-3.5 ${loadingSlots ? 'animate-spin' : ''}`} />
                  {loadingSlots ? 'Loading…' : 'Preview'}
                </button>
              </div>
            </div>

            {timezone && (
              <p className="text-xs text-gray-500">
                Times are in{' '}
                <span className="font-mono font-semibold text-gray-700">{timezone}</span>.
              </p>
            )}

            {error && <p className="text-sm text-red-600">{error}</p>}

            {hasRun && !loadingSlots && !error && (
              <>
                {slots.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center">
                    <p className="text-sm font-medium text-gray-700">No slots in this window</p>
                    <p className="mt-1 text-xs text-gray-500">
                      Check weekly hours and overrides, or widen the date range.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-xs text-gray-500">
                      {slots.length} {slots.length === 1 ? 'slot' : 'slots'} available
                    </p>
                    {grouped.map((day) => (
                      <div
                        key={day.dateLabel}
                        className="rounded-lg border border-gray-200 bg-white p-3"
                      >
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
                          {day.dateLabel}
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {day.items.map((slot, i) => {
                            const start = new Date(slot.startUtc)
                            const time = timeFmt ? timeFmt.format(start) : start.toISOString()
                            const providerNames = slot.providerIds
                              .map((pid) => providers.find((p) => p.id === pid)?.display_name)
                              .filter(Boolean) as string[]
                            return (
                              <div
                                key={`${slot.startUtc}-${i}`}
                                className="rounded-lg border border-brand-100 bg-brand-50 px-2.5 py-1.5"
                              >
                                <p className="text-xs font-semibold text-brand-700">{time}</p>
                                {providerNames.length > 0 && (
                                  <p className="mt-0.5 text-[10px] text-brand-600">
                                    {providerNames.join(', ')}
                                  </p>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {!hasRun && !loadingSlots && (
              <p className="text-xs text-gray-400">
                Click <span className="font-medium">Preview</span> to load slots for the selected
                service and date range.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
