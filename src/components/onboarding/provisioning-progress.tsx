/**
 * Phase 5 M3 — live status stepper for the phone-number provisioning
 * chain.
 *
 * Polls getProvisioningStatusAction every 2s and renders a fixed 4-row
 * stepper for the canonical steps (buy_twilio_number, register_vapi_phone,
 * register_a2p_brand, register_a2p_campaign).
 *
 * Why 2s and not WebSockets / SSE:
 *   - The chain takes ~2-5 minutes end-to-end (Twilio buy is seconds,
 *     Vapi register is seconds, A2P brand review is the slow one — can
 *     be minutes). 2s polling gives a responsive feel without
 *     hammering the DB; the action's RLS-narrowed SELECT is cheap.
 *   - We already have CRON_SECRET-gated cron infrastructure (M5
 *     drains the queue) and don't need a realtime channel just for
 *     this one UX surface. If onboarding ever supports multiple
 *     concurrent provisioning chains we can revisit.
 *
 * Why we render "not_started" rows up-front (before they're enqueued):
 *   - M5's runner chains the steps lazily — register_vapi_phone is not
 *     inserted into provisioning_jobs until buy_twilio_number writes
 *     back the twilio_phone_sid. Without rendering placeholders, the
 *     stepper would visually jump from one row to four as the chain
 *     progresses, which feels broken. The fixed 4-row layout is the
 *     contract; the action backs it.
 *
 * On completion: parent component is notified via onDone so it can
 * redirect to /settings/call-agent (the post-onboarding hub).
 */

'use client'

import { useEffect, useRef, useState } from 'react'
import { getProvisioningStatusAction } from '@/app/onboarding/phone-number/actions'
import {
  PROVISIONING_STEPS,
  type ProvisioningStep,
  type ProvisioningStepRow,
} from '@/app/onboarding/phone-number/steps'

interface ProvisioningProgressProps {
  onDone:   () => void
}

const STEP_LABELS: Record<ProvisioningStep, { title: string; help: string }> = {
  buy_twilio_number: {
    title: 'Purchase the phone number',
    help:  'Twilio reserves and bills the number to our account; usually <30s.',
  },
  register_vapi_phone: {
    title: 'Bind the AI receptionist',
    help:  'Wires Vapi to answer inbound calls on the new number.',
  },
  register_a2p_brand: {
    title: 'Register brand for SMS',
    help:  'US carriers review the business identity. This is the slow step (a few minutes).',
  },
  register_a2p_campaign: {
    title: 'Approve messaging campaign',
    help:  'Submits the sample reminder message to the carriers for use-case approval.',
  },
}

export function ProvisioningProgress({ onDone }: ProvisioningProgressProps) {
  const [rows,    setRows]    = useState<ProvisioningStepRow[]>(
    PROVISIONING_STEPS.map(step => ({
      step,
      status:     'not_started',
      last_error: null,
      updated_at: null,
    })),
  )
  const [doneFlag, setDoneFlag] = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const doneFiredRef = useRef(false)

  useEffect(() => {
    let cancelled = false

    async function tick() {
      const r = await getProvisioningStatusAction()
      if (cancelled) return

      if (!r.ok) {
        setError(r.error)
        return
      }
      setError(null)
      setRows(r.steps)
      setDoneFlag(r.done)

      // Fire onDone exactly once. We DON'T return after firing —
      // letting the poll keep running for a few more ticks means the
      // final UI shows all-green for ~2s before the parent navigates
      // away, which feels less abrupt than an instant redirect.
      if (r.done && !doneFiredRef.current) {
        doneFiredRef.current = true
        onDone()
      }
    }

    // Fire immediately, then every 2s. The action is cheap and idempotent.
    void tick()
    const handle = setInterval(tick, 2_000)
    return () => {
      cancelled = true
      clearInterval(handle)
    }
  }, [onDone])

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-brand-50 border border-brand-100 px-4 py-3">
        <p className="text-sm text-gray-700">
          {doneFlag
            ? 'All set — taking you to your call agent settings…'
            : 'We\'re provisioning your number. Keep this tab open; if you close it, you can resume by visiting /onboarding/phone-number.'}
        </p>
      </div>

      <ol className="space-y-2">
        {rows.map((row, idx) => (
          <StepRow key={row.step} row={row} index={idx} />
        ))}
      </ol>

      {error && (
        <p className="text-xs text-amber-700">
          Couldn't refresh status: {error}. Retrying…
        </p>
      )}
    </div>
  )
}

// ── Stepper row ──────────────────────────────────────────────────
function StepRow({ row, index }: { row: ProvisioningStepRow; index: number }) {
  const meta = STEP_LABELS[row.step]
  const tone =
    row.status === 'succeeded'   ? 'success'  :
    row.status === 'failed'      ? 'error'    :
    row.status === 'in_progress' ? 'active'   :
    row.status === 'pending'     ? 'queued'   :
                                   'idle'

  return (
    <li
      className={
        'rounded-lg border px-4 py-3 transition-colors ' +
        (tone === 'success'
          ? 'border-emerald-200 bg-emerald-50'
          : tone === 'error'
          ? 'border-red-200 bg-red-50'
          : tone === 'active'
          ? 'border-brand-200 bg-brand-50'
          : tone === 'queued'
          ? 'border-amber-200 bg-amber-50'
          : 'border-gray-200 bg-white')
      }
    >
      <div className="flex items-start gap-3">
        <StatusDot tone={tone} number={index + 1} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-900">
              {meta.title}
            </span>
            <StatusBadge tone={tone} />
          </div>
          <p className="mt-0.5 text-xs text-gray-500">{meta.help}</p>
          {row.status === 'failed' && row.last_error && (
            <p className="mt-1.5 text-xs text-red-700 break-words">
              {row.last_error}
            </p>
          )}
        </div>
      </div>
    </li>
  )
}

function StatusDot({ tone, number }: { tone: string; number: number }) {
  const base = 'flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold flex-shrink-0'
  if (tone === 'success') {
    return (
      <span className={`${base} bg-emerald-500 text-white`} aria-label="Succeeded">
        ✓
      </span>
    )
  }
  if (tone === 'error') {
    return (
      <span className={`${base} bg-red-500 text-white`} aria-label="Failed">
        !
      </span>
    )
  }
  if (tone === 'active') {
    return (
      <span className={`${base} bg-brand-500 text-white animate-pulse`} aria-label="In progress">
        {number}
      </span>
    )
  }
  if (tone === 'queued') {
    return (
      <span className={`${base} bg-amber-200 text-amber-900`} aria-label="Queued">
        {number}
      </span>
    )
  }
  return (
    <span className={`${base} bg-gray-100 text-gray-400`} aria-label="Not started">
      {number}
    </span>
  )
}

function StatusBadge({ tone }: { tone: string }) {
  const map: Record<string, { text: string; cls: string }> = {
    success: { text: 'Done',        cls: 'bg-emerald-100 text-emerald-700' },
    error:   { text: 'Failed',      cls: 'bg-red-100      text-red-700'     },
    active:  { text: 'Working…',    cls: 'bg-brand-100    text-brand-700'   },
    queued:  { text: 'Queued',      cls: 'bg-amber-100    text-amber-700'   },
    idle:    { text: 'Waiting',     cls: 'bg-gray-100     text-gray-500'    },
  }
  const m = map[tone] ?? map.idle
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${m.cls}`}>
      {m.text}
    </span>
  )
}
