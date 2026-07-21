'use client'

/**
 * Super-admin card: per-tenant client-messaging kill switch.
 * Shared-sender insurance — cuts ONE tenant's customer-facing sends
 * (WhatsApp + SMS) without touching the platform number or the
 * tenant's own owner alerts. Internal tool → English copy.
 */

import { useState, useTransition } from 'react'
import { toggleClientMessaging } from '@/app/admin/accounts/actions'

export function MessagingKillSwitch({
  orgId,
  blockedAt,
  blockedReason,
}: {
  orgId: string
  blockedAt: string | null
  blockedReason: string | null
}) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const blocked = Boolean(blockedAt)

  const flip = (block: boolean) => {
    setError(null)
    startTransition(async () => {
      const res = await toggleClientMessaging({ orgId, block, reason: reason || undefined })
      if (!res.ok) setError(res.error)
    })
  }

  return (
    <div className={`rounded-xl border p-4 ${blocked ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-white'}`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Client messaging</h3>
          {blocked ? (
            <p className="mt-0.5 text-xs text-red-700">
              BLOCKED since {new Date(blockedAt!).toLocaleString()} — {blockedReason ?? 'no reason recorded'}
            </p>
          ) : (
            <p className="mt-0.5 text-xs text-gray-500">
              Active — this org can message customers via the shared WhatsApp/SMS sender.
            </p>
          )}
        </div>
        {blocked ? (
          <button
            onClick={() => flip(false)}
            disabled={pending}
            className="shrink-0 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {pending ? 'Unblocking…' : 'Unblock'}
          </button>
        ) : (
          <button
            onClick={() => flip(true)}
            disabled={pending}
            className="shrink-0 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
          >
            {pending ? 'Blocking…' : 'Block sends'}
          </button>
        )}
      </div>
      {!blocked && (
        <input
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="Reason (recorded in the audit log)"
          maxLength={300}
          className="mt-3 w-full rounded-lg border border-gray-200 px-3 py-1.5 text-xs"
        />
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  )
}
