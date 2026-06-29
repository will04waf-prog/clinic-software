'use client'

/**
 * Phase 5 M6 — single row of the /admin/numbers table.
 *
 * Each row is one organization. The page (server component) does the
 * heavy lifting — fetches orgs, computes health buckets, derives last-
 * call timestamps and 30-day counts — and then passes a flat shape to
 * this client component. This split keeps the per-row interaction
 * (the "Re-trigger provisioning" button) on the client without
 * shipping the entire table-rendering loop as a client island.
 *
 * The retrigger button is only rendered for rows the server marked
 * health='broken'. We could also offer it for 'pending' rows but
 * that would let the operator pile on stuck-in-flight jobs; the
 * action would no-op via 'already_queued' anyway. Hiding it is
 * cleaner UX — the dashboard signals "this needs your attention"
 * only on broken.
 */

import { useState, useTransition } from 'react'
import { formatRelative, formatPhone } from '@/lib/utils'
import { retriggerProvisioning, type ProvisioningStep } from '@/app/admin/numbers/actions'
import { cn } from '@/lib/utils'

export type NumberRowData = {
  orgId:                 string
  orgName:               string
  e164:                  string | null
  vapiPhoneNumberId:     string | null
  a2pStatus:             string  // 'not_started' | 'pending' | 'approved' | 'rejected'
  voiceReminderEnabled:  boolean
  lastInboundAt:         string | null
  lastOutboundAt:        string | null
  calls30d:              number
  sms30d:                number
  health:                'healthy' | 'pending' | 'broken'
  brokenReasons:         string[]   // human-readable; e.g. 'A2P rejected', 'No Vapi binding'
  // Which step the super-admin should re-enqueue, derived server-side
  // from the broken reasons. NULL when there's nothing obvious to
  // re-trigger (e.g. healthy or pending rows).
  suggestedStep:         ProvisioningStep | null
}

const A2P_BADGE: Record<string, string> = {
  approved:    'bg-emerald-100 text-emerald-700',
  pending:     'bg-yellow-100 text-yellow-700',
  rejected:    'bg-red-100 text-red-700',
  not_started: 'bg-gray-100 text-gray-500',
}

const HEALTH_DOT: Record<NumberRowData['health'], string> = {
  healthy: 'bg-emerald-500',
  pending: 'bg-yellow-400',
  broken:  'bg-red-500',
}

const HEALTH_LABEL: Record<NumberRowData['health'], string> = {
  healthy: 'Healthy',
  pending: 'Pending',
  broken:  'Broken',
}

export function NumberRow({ row }: { row: NumberRowData }) {
  const [pending, startTransition] = useTransition()
  const [toast, setToast] = useState<string | null>(null)

  function handleRetrigger() {
    if (!row.suggestedStep) return
    startTransition(async () => {
      const res = await retriggerProvisioning({
        orgId: row.orgId,
        step:  row.suggestedStep!,
      })
      if (!res.ok) {
        setToast(`Failed: ${res.error}`)
      } else if (res.state === 'already_queued') {
        setToast('Already queued')
      } else if (res.state === 'rerun_after_success') {
        setToast('Re-queued (was succeeded)')
      } else {
        setToast('Enqueued')
      }
      setTimeout(() => setToast(null), 4000)
    })
  }

  // Vapi-binding column: green dot if vapi_phone_number_id is set.
  // We don't probe the live binding here (that requires a Vapi API
  // call per row and would balloon page load); the dashboard's per-
  // org settings page has a live-probe row already (vapi-health
  // route added in M1). This is an at-a-glance signal only.
  const vapiBound = Boolean(row.vapiPhoneNumberId)

  return (
    <tr className="hover:bg-gray-50 transition-colors">
      <td className="px-5 py-3">
        <div className="flex items-center gap-2">
          <span className={cn('h-2 w-2 rounded-full shrink-0', HEALTH_DOT[row.health])} title={HEALTH_LABEL[row.health]} />
          <div>
            <p className="font-medium text-gray-900">{row.orgName}</p>
            {row.brokenReasons.length > 0 && (
              <p className="text-xs text-red-500 mt-0.5">
                {row.brokenReasons.join(' · ')}
              </p>
            )}
          </div>
        </div>
      </td>
      <td className="px-5 py-3 text-gray-700 font-mono text-xs">
        {row.e164 ? formatPhone(row.e164) : <span className="text-gray-400">—</span>}
      </td>
      <td className="px-5 py-3">
        <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', A2P_BADGE[row.a2pStatus] ?? 'bg-gray-100 text-gray-500')}>
          {row.a2pStatus.replace('_', ' ')}
        </span>
      </td>
      <td className="px-5 py-3">
        <span className={cn(
          'inline-flex items-center gap-1 text-xs',
          vapiBound ? 'text-emerald-700' : 'text-gray-400',
        )}>
          <span className={cn('h-1.5 w-1.5 rounded-full', vapiBound ? 'bg-emerald-500' : 'bg-gray-300')} />
          {vapiBound ? 'Bound' : 'Unbound'}
        </span>
      </td>
      <td className="px-5 py-3 text-xs text-gray-500">
        {row.lastInboundAt ? formatRelative(row.lastInboundAt) : <span className="text-gray-300">never</span>}
      </td>
      <td className="px-5 py-3 text-xs text-gray-500">
        {row.lastOutboundAt ? formatRelative(row.lastOutboundAt) : <span className="text-gray-300">never</span>}
      </td>
      <td className="px-5 py-3 text-gray-600 tabular-nums">{row.calls30d}</td>
      <td className="px-5 py-3 text-gray-600 tabular-nums">{row.sms30d}</td>
      <td className="px-5 py-3">
        {row.health === 'broken' && row.suggestedStep ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleRetrigger}
              disabled={pending}
              className={cn(
                'inline-flex items-center rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                pending
                  ? 'bg-gray-100 text-gray-400 cursor-wait'
                  : 'bg-brand-50 text-brand-700 hover:bg-brand-100',
              )}
            >
              {pending ? 'Queuing…' : 'Re-trigger'}
            </button>
            {toast && <span className="text-[11px] text-gray-500">{toast}</span>}
          </div>
        ) : (
          <span className="text-gray-300 text-xs">—</span>
        )}
      </td>
    </tr>
  )
}
