'use client'

/**
 * Client view for /manage/[token]. Renders one of four states:
 *
 *   - invalid:  the token didn't verify or the booking row is gone
 *   - canceled: the booking is already canceled
 *   - past:     the appointment already happened
 *   - active:   the patient can reschedule or cancel
 *
 * The 'active' state has two action affordances:
 *   1. "Pick a different time" — expands a horizontal day strip + slot
 *      grid loaded from /api/booking/public/[slug]/availability.
 *      Selecting a slot POSTs /api/booking/reschedule with the token.
 *   2. "Cancel appointment" — opens a confirm dialog; "Yes, cancel"
 *      POSTs /api/booking/cancel with the token.
 *
 * Brand colors mirror the public /book/[slug] page so the patient
 * experiences one continuous flow.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  Calendar, CalendarCheck, Check, AlertCircle, Loader2, X,
} from 'lucide-react'
import { getVerticalConfig, type VerticalTerms } from '@/lib/vertical/config'

export type ManageState =
  | { kind: 'invalid' }
  | { kind: 'canceled'; orgName: string }
  | { kind: 'past'; orgName: string }
  | {
      kind: 'active'
      token: string
      orgName: string
      orgSlug: string
      timezone: string
      service: { id: string; name: string; durationMin: number }
      provider: { id: string; displayName: string; roleLabel: string | null } | null
      scheduledAtUtc: string
    }

interface Slot { startUtc: string; endUtc: string; providerId: string }

const SEARCH_HORIZON_DAYS = 14

export function ManageView({ state, vertical }: { state: ManageState; vertical: string | null }) {
  // Terminology follows the tenant's vertical. The med-spa literal on this
  // surface is 'appointment' (not 'consultation'), so terms.engagement is
  // byte-identical for med-spa and used directly; clinic → terms.business.
  const terms = getVerticalConfig(vertical).terms
  return (
    <div className="min-h-screen bg-[#FAF6EC] py-10 px-4">
      <div className="mx-auto max-w-xl rounded-2xl border border-[#0B2027]/10 bg-white p-6 shadow-sm">
        {state.kind === 'invalid'  && <InvalidView terms={terms} />}
        {state.kind === 'canceled' && <CanceledView orgName={state.orgName} terms={terms} />}
        {state.kind === 'past'     && <PastView orgName={state.orgName} terms={terms} />}
        {state.kind === 'active'   && <ActiveView state={state} terms={terms} />}
      </div>
    </div>
  )
}

function InvalidView({ terms }: { terms: VerticalTerms }) {
  return (
    <div className="space-y-3 text-center">
      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-[#B5710F]/15">
        <AlertCircle className="h-5 w-5 text-[#B5710F]" />
      </div>
      <h1 className="text-[17px] font-semibold text-[#14241D]">This link can't be used</h1>
      <p className="text-[13px] text-[#4A5A60]">
        The booking management link is invalid or has expired. If you need to change your {terms.engagement}, contact your {terms.business} directly.
      </p>
    </div>
  )
}

function CanceledView({ orgName, terms }: { orgName: string; terms: VerticalTerms }) {
  return (
    <div className="space-y-3 text-center">
      <h1 className="text-[17px] font-semibold text-[#14241D]">Your {terms.engagement} is canceled</h1>
      <p className="text-[13px] text-[#4A5A60]">
        This {terms.engagement} at {orgName} has been canceled. To book a new visit, contact the {terms.business} or visit their booking page.
      </p>
    </div>
  )
}

function PastView({ orgName, terms }: { orgName: string; terms: VerticalTerms }) {
  return (
    <div className="space-y-3 text-center">
      <h1 className="text-[17px] font-semibold text-[#14241D]">This {terms.engagement} has passed</h1>
      <p className="text-[13px] text-[#4A5A60]">
        Your visit at {orgName} is already in the past. To book a new visit, contact the {terms.business}.
      </p>
    </div>
  )
}

function ActiveView({ state, terms }: { state: Extract<ManageState, { kind: 'active' }>; terms: VerticalTerms }) {
  type Mode = 'view' | 'reschedule' | 'confirm-cancel' | 'canceled-done' | 'rescheduled-done'
  const [mode, setMode]   = useState<Mode>('view')
  const [error, setError] = useState<string>('')
  const [newScheduledAt, setNewScheduledAt] = useState<string | null>(null)

  const longFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: state.timezone,
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })
  const timeFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: state.timezone,
    hour: 'numeric', minute: '2-digit', hour12: true,
  })

  if (mode === 'canceled-done') {
    return (
      <div className="space-y-4 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#02C39A]/15">
          <Check className="h-6 w-6 text-[#04B08C]" />
        </div>
        <h1 className="text-[17px] font-semibold text-[#14241D]">Canceled</h1>
        <p className="text-[13px] text-[#4A5A60]">
          Your {terms.engagement} at {state.orgName} has been canceled. You can close this page.
        </p>
      </div>
    )
  }

  if (mode === 'rescheduled-done' && newScheduledAt) {
    return (
      <div className="space-y-4 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#02C39A]/15">
          <Check className="h-6 w-6 text-[#04B08C]" />
        </div>
        <h1 className="text-[17px] font-semibold text-[#14241D]">Rescheduled</h1>
        <p className="text-[13px] text-[#4A5A60]">
          Your new {terms.engagement} at {state.orgName} is {longFmt.format(new Date(newScheduledAt))} at
          {' '}{timeFmt.format(new Date(newScheduledAt))}. A confirmation text is on its way if your
          phone is opted in.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-[17px] font-semibold text-[#14241D]">Your {terms.engagement}</h1>
        <p className="text-[12.5px] text-[#7E8C90]">at {state.orgName}</p>
      </header>

      <BookingCard
        serviceName={state.service.name}
        provider={state.provider}
        scheduledAt={state.scheduledAtUtc}
        durationMin={state.service.durationMin}
        longFmt={longFmt}
        timeFmt={timeFmt}
      />

      {mode === 'view' && (
        <div className="space-y-2.5">
          <button
            type="button"
            onClick={() => { setError(''); setMode('reschedule') }}
            className="w-full rounded-lg border border-[#02C39A]/40 bg-white px-4 py-3 text-[14px] font-semibold text-[#04B08C] hover:bg-[#02C39A]/10"
          >
            Pick a different time
          </button>
          <button
            type="button"
            onClick={() => { setError(''); setMode('confirm-cancel') }}
            className="w-full rounded-lg border border-[#0B2027]/15 bg-white px-4 py-3 text-[13px] font-medium text-[#B5710F] hover:bg-[#B5710F]/5"
          >
            Cancel {terms.engagement}
          </button>
        </div>
      )}

      {mode === 'reschedule' && (
        <ReschedulePicker
          state={state}
          terms={terms}
          onCancel={() => { setError(''); setMode('view') }}
          onError={setError}
          onSuccess={(iso) => {
            setNewScheduledAt(iso)
            setMode('rescheduled-done')
          }}
        />
      )}

      {mode === 'confirm-cancel' && (
        <CancelConfirm
          state={state}
          terms={terms}
          onBack={() => { setError(''); setMode('view') }}
          onError={setError}
          onSuccess={() => setMode('canceled-done')}
        />
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-[#B5710F]/30 bg-[#B5710F]/10 p-3 text-[12.5px] text-[#B5710F]">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  )
}

function BookingCard({
  serviceName, provider, scheduledAt, durationMin, longFmt, timeFmt,
}: {
  serviceName: string
  provider: { displayName: string; roleLabel: string | null } | null
  scheduledAt: string
  durationMin: number
  longFmt: Intl.DateTimeFormat
  timeFmt: Intl.DateTimeFormat
}) {
  return (
    <div className="rounded-xl border border-[#02C39A]/30 bg-white p-4 text-[13px] text-[#14241D]">
      <p className="text-[11.5px] font-semibold uppercase tracking-wider text-[#04B08C]">
        {serviceName}
      </p>
      <p className="mt-1 text-[15px] font-semibold">
        {longFmt.format(new Date(scheduledAt))}
      </p>
      <p className="mt-0.5 text-[#4A5A60]">
        <Calendar className="mr-1 inline h-3.5 w-3.5 align-text-bottom" />
        {timeFmt.format(new Date(scheduledAt))} · {durationMin} min
      </p>
      {provider && (
        <p className="mt-1 text-[12px] text-[#7E8C90]">
          with {provider.displayName}
          {provider.roleLabel ? `, ${provider.roleLabel}` : ''}
        </p>
      )}
    </div>
  )
}

function CancelConfirm({
  state, terms, onBack, onError, onSuccess,
}: {
  state: Extract<ManageState, { kind: 'active' }>
  terms: VerticalTerms
  onBack: () => void
  onError: (msg: string) => void
  onSuccess: () => void
}) {
  const [submitting, setSubmitting] = useState(false)
  async function doCancel() {
    setSubmitting(true)
    onError('')
    try {
      const res = await fetch('/api/booking/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manage_token: state.token }),
      })
      // 410 already_canceled_or_invalid means the booking is in the
      // terminal cancelled state we wanted anyway (e.g. double-tap,
      // owner canceled in parallel). Treat as success rather than
      // showing the patient a confusing error.
      if (res.ok || res.status === 410) {
        onSuccess()
        return
      }
      const j = await res.json().catch(() => ({}))
      onError(j.message || `Could not cancel. Please try again or call the ${terms.business}.`)
    } catch {
      onError('Network problem. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }
  return (
    <div className="rounded-lg border border-[#B5710F]/30 bg-[#B5710F]/5 p-4">
      <p className="text-[13px] text-[#14241D]">
        Are you sure you want to cancel your {terms.engagement}? This can't be undone — you'd need to book again.
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={doCancel}
          disabled={submitting}
          className="flex-1 rounded-lg bg-[#B5710F] px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-[#a4660d] disabled:opacity-60"
        >
          {submitting ? 'Canceling…' : 'Yes, cancel'}
        </button>
        <button
          type="button"
          onClick={onBack}
          disabled={submitting}
          className="rounded-lg border border-[#0B2027]/15 bg-white px-4 py-2.5 text-[13px] font-medium text-[#14241D] hover:bg-[#FAF6EC] disabled:opacity-60"
        >
          Keep it
        </button>
      </div>
    </div>
  )
}

function ReschedulePicker({
  state, terms, onCancel, onError, onSuccess,
}: {
  state: Extract<ManageState, { kind: 'active' }>
  terms: VerticalTerms
  onCancel: () => void
  onError: (msg: string) => void
  onSuccess: (newIso: string) => void
}) {
  const [slots, setSlots]     = useState<Slot[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [selected, setSelected]     = useState<Slot | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    onError('')
    try {
      const fromUtc = new Date()
      const toUtc = new Date(fromUtc.getTime() + SEARCH_HORIZON_DAYS * 86_400_000)
      const url = new URL(`/api/booking/public/${encodeURIComponent(state.orgSlug)}/availability`, window.location.origin)
      url.searchParams.set('serviceId', state.service.id)
      url.searchParams.set('from', fromUtc.toISOString())
      url.searchParams.set('to',   toUtc.toISOString())
      const res = await fetch(url.toString(), { cache: 'no-store' })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        onError(j.message || j.error || 'Could not load available times.')
        setSlots([])
        return
      }
      const json = (await res.json()) as { slots: Slot[] }
      // Exclude the patient's own current slot from the picker — they
      // can't reschedule to the same time. (The API would also reject
      // that, but hiding it is cleaner UX.)
      const currentStart = state.scheduledAtUtc
      setSlots((json.slots ?? []).filter(s => s.startUtc !== currentStart))
    } catch {
      onError('Network problem loading times. Please try again.')
      setSlots([])
    } finally {
      setLoading(false)
    }
  }, [state, onError])
  useEffect(() => { load() }, [load])

  async function submit() {
    if (!selected) return
    setSubmitting(true)
    onError('')
    try {
      const res = await fetch('/api/booking/reschedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          manage_token: state.token,
          scheduled_at: selected.startUtc,
          // Picker surfaces multi-provider slots — pass the chosen
          // provider through so the backend updates provider_id
          // atomically alongside scheduled_at.
          provider_id:  selected.providerId,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        if (j.error === 'slot_unavailable') {
          onError('That time was just taken — please pick another.')
          await load()
        } else {
          onError(j.message || 'Could not reschedule. Please try again.')
        }
        return
      }
      const j = await res.json()
      onSuccess(j.scheduled_at as string)
    } catch {
      onError('Network problem. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const dayFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: state.timezone, weekday: 'short', month: 'short', day: 'numeric',
  })
  const slotTimeFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: state.timezone, hour: 'numeric', minute: '2-digit', hour12: true,
  })

  // Group slots by clinic-local day.
  const grouped: Array<{ dayLabel: string; dayKey: string; slots: Slot[] }> = []
  if (slots) {
    const byKey = new Map<string, Slot[]>()
    const keyFmt = new Intl.DateTimeFormat('en-CA', { timeZone: state.timezone, dateStyle: 'short' })
    for (const s of slots) {
      const key = keyFmt.format(new Date(s.startUtc))
      const arr = byKey.get(key) ?? []
      arr.push(s)
      byKey.set(key, arr)
    }
    for (const [key, daySlots] of Array.from(byKey.entries())) {
      grouped.push({
        dayKey:   key,
        dayLabel: dayFmt.format(new Date(daySlots[0].startUtc)),
        slots:    daySlots,
      })
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-semibold text-[#14241D]">Pick a new time</p>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center gap-1 text-[12px] text-[#7E8C90] hover:text-[#14241D]"
        >
          <X className="h-3.5 w-3.5" />
          Back
        </button>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-[12.5px] text-[#7E8C90]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading available times…
        </div>
      )}

      {!loading && slots && slots.length === 0 && (
        <p className="text-[12.5px] text-[#7E8C90]">
          No open times in the next {SEARCH_HORIZON_DAYS} days. Contact the {terms.business} to find a slot.
        </p>
      )}

      {!loading && grouped.length > 0 && (
        <div className="max-h-[420px] space-y-3 overflow-y-auto rounded-lg border border-[#0B2027]/10 bg-[#FAF6EC]/60 p-3">
          {grouped.map(g => (
            <div key={g.dayKey}>
              <p className="text-[11.5px] font-semibold uppercase tracking-wider text-[#04B08C]">
                {g.dayLabel}
              </p>
              <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                {g.slots.map(s => {
                  const isSel = selected?.startUtc === s.startUtc
                  return (
                    <button
                      key={s.startUtc + s.providerId}
                      type="button"
                      onClick={() => setSelected(s)}
                      className={`rounded-md border px-2 py-1.5 text-[12px] font-medium ${
                        isSel
                          ? 'border-[#02C39A] bg-[#02C39A] text-white'
                          : 'border-[#0B2027]/15 bg-white text-[#14241D] hover:border-[#02C39A]/50'
                      }`}
                    >
                      {slotTimeFmt.format(new Date(s.startUtc))}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={!selected || submitting}
        className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#02C39A] px-4 py-3 text-[14px] font-semibold text-white hover:bg-[#04B08C] disabled:opacity-60"
      >
        {submitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Rescheduling…
          </>
        ) : (
          <>
            <CalendarCheck className="h-4 w-4" />
            Confirm new time
          </>
        )}
      </button>
    </div>
  )
}
