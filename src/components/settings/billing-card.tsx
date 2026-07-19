'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { TIER_DISPLAY_NAMES, TIER_PRICING, type TierId } from '@/lib/billing/tiers'

const STATUS_BADGE: Record<string, string> = {
  trial:     'bg-brand-50 text-brand-700',
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

  // Raw server/Stripe error strings never render here — the API routes
  // return stable codes and log the real message server-side; the user
  // gets one friendly line either way.
  const FRIENDLY_ERROR = 'Could not open billing right now. Please try again in a moment.'

  async function post(path: string) {
    setLoading(true)
    setError(null)
    try {
      const res  = await fetch(path, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.url) throw new Error()
      window.location.href = data.url
    } catch {
      setError(FRIENDLY_ERROR)
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
            // Route archaeology 2026-07-15: the old non-active branch sent
            // owners to /pricing (retired 3-tier page, now a 301 to the
            // homepage). There is ONE plan now — the same subscribe route
            // the CRM card uses, which hands back a portal URL when a
            // subscription already exists.
            post(isActive ? '/api/billing/portal' : '/api/billing/subscribe')
          }}
          disabled={loading}
        >
          {buttonLabel}
        </Button>
      </CardContent>
    </Card>
  )
}
