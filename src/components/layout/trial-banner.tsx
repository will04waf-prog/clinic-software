import Link from 'next/link'

interface TrialBannerProps {
  planStatus: string
  trialEndsAt: string | null
}

export function TrialBanner({ planStatus, trialEndsAt }: TrialBannerProps) {
  if (planStatus === 'active') return null

  const now = new Date()
  const endsAt = trialEndsAt ? new Date(trialEndsAt) : null
  const daysLeft = endsAt ? Math.ceil((endsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : null
  const isExpired = planStatus === 'trial_expired' || (daysLeft !== null && daysLeft <= 0)

  // Only show banner when trial is expiring soon (≤7 days) or already expired
  if (!isExpired && daysLeft !== null && daysLeft > 7) return null

  if (isExpired) {
    return (
      <div className="flex items-center justify-between gap-4 bg-red-600 px-5 py-2.5 text-white text-sm shrink-0">
        <p className="font-medium">
          Your 14-day trial has ended. Subscribe to continue using Tarhunna.
        </p>
        <Link
          href="/settings"
          className="shrink-0 rounded-md bg-white px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 transition-colors"
        >
          Subscribe now
        </Link>
      </div>
    )
  }

  // Trial ending soon
  return (
    <div className="flex items-center justify-between gap-4 bg-amber-500 px-5 py-2.5 text-white text-sm shrink-0">
      <p className="font-medium">
        {daysLeft === 1
          ? 'Your trial ends tomorrow.'
          : `Your trial ends in ${daysLeft} days.`}{' '}
        Subscribe to keep full access.
      </p>
      <Link
        href="/settings"
        className="shrink-0 rounded-md bg-white px-3 py-1 text-xs font-semibold text-amber-600 hover:bg-amber-50 transition-colors"
      >
        Subscribe
      </Link>
    </div>
  )
}
