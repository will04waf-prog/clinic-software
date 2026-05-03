'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { TIER_DISPLAY_NAMES, TIER_PRICING, type TierId } from '@/lib/billing/tiers'

const STATUS_BADGE: Record<string, string> = {
  trial:     'bg-blue-100 text-blue-700',
  active:    'bg-emerald-100 text-emerald-700',
  past_due:  'bg-yellow-100 text-yellow-700',
  suspended: 'bg-orange-100 text-orange-700',
  canceled:  'bg-red-100 text-red-700',
}

const STATUS_LABEL: Record<string, string> = {
  trial:     'Trial',
  active:    'Active',
  past_due:  'Past Due',
  suspended: 'Suspended',
  canceled:  'Canceled',
}

interface BillingCardProps {
  plan: string
  planStatus: string
  hasStripeCustomer: boolean
}

function formatPlanLabel(plan: string): string {
  // Legacy 'pro' rows render as "Professional". Real tier values render via
  // the tier metadata. Trial / unknown values fall back to a neutral label.
  const tierKey: TierId | null =
    plan === 'pro'                                                       ? 'professional' :
    (plan === 'starter' || plan === 'professional' || plan === 'scale')  ? plan          :
    null

  if (!tierKey) return 'Tarhunna — Trial'

  const name    = TIER_DISPLAY_NAMES[tierKey]
  const dollars = (TIER_PRICING[tierKey].monthlyCents / 100).toFixed(0)
  return `Tarhunna ${name} — $${dollars}/mo`
}

export function BillingCard({ plan, planStatus, hasStripeCustomer }: BillingCardProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  async function openPortal() {
    setLoading(true)
    setError(null)
    try {
      const res  = await fetch('/api/billing/portal', { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok)   throw new Error(data.error ?? `HTTP ${res.status}`)
      if (!data.url) throw new Error('No redirect URL returned')
      window.location.href = data.url
    } catch (err: any) {
      setError(err.message)
      setLoading(false)
    }
  }

  const isActive  = planStatus === 'active' && hasStripeCustomer
  const buttonLabel =
    loading           ? 'Loading…'         :
    isActive          ? 'Manage Billing'   :
    planStatus === 'canceled' ? 'Resubscribe' :
    'Start Subscription'

  return (
    <Card>
      <CardHeader><CardTitle>Billing</CardTitle></CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-gray-500">Status</span>
          <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_BADGE[planStatus] ?? 'bg-gray-100 text-gray-600'}`}>
            {STATUS_LABEL[planStatus] ?? planStatus}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-gray-500">Plan</span>
          <span className="font-medium text-gray-900">{formatPlanLabel(plan)}</span>
        </div>

        {planStatus === 'past_due' && (
          <p className="text-xs text-yellow-700 bg-yellow-50 rounded-lg px-3 py-2">
            Your last payment failed. Update your payment method to avoid service interruption.
          </p>
        )}

        {planStatus === 'suspended' && (
          <p className="text-xs text-orange-700 bg-orange-50 rounded-lg px-3 py-2">
            Your account is suspended. Contact support or update your billing to restore access.
          </p>
        )}

        {error && <p className="text-xs text-red-600">{error}</p>}

        <Button
          size="sm"
          variant={isActive ? 'outline' : 'default'}
          onClick={() => {
            if (isActive) {
              openPortal()
            } else {
              window.location.href = '/pricing'
            }
          }}
          disabled={loading}
        >
          {buttonLabel}
        </Button>
      </CardContent>
    </Card>
  )
}
