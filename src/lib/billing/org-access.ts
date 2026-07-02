// ============================================================
// Org lockout — single source of truth for "is this org blocked
// from using the product?".
// ============================================================
//
// Used by:
//   - src/proxy.ts             (page navigation → redirect to /settings)
//   - outbound crons           (SMS / voice sends that cost real Twilio
//                               and Vapi money must not fire for orgs
//                               that no longer pay)
//
// /settings, /billing, /admin and /onboarding stay reachable in the
// proxy so a blocked owner can always pay their way back in — this
// module only answers WHETHER the org is blocked, never where to send
// them.
//
// Pure function, no I/O — safe to import from edge middleware.

export type BlockedReason = 'trial_expired' | 'canceled' | 'suspended' | null

export function blockedReason(
  planStatus:  string | null | undefined,
  trialEndsAt: string | null | undefined,
  now: Date = new Date(),
): BlockedReason {
  if (planStatus === 'canceled')      return 'canceled'
  if (planStatus === 'suspended')     return 'suspended'
  if (planStatus === 'trial_expired') return 'trial_expired'

  // A lapsed trial the expire-trials cron hasn't flipped yet. A null or
  // unparseable trial_ends_at is treated as NOT blocked — that's the
  // "trial row never initialized" case, which effectiveTierFor already
  // downgrades to plan-based access rather than locking anyone out.
  if (
    planStatus === 'trial' &&
    trialEndsAt != null &&
    !Number.isNaN(Date.parse(trialEndsAt)) &&
    new Date(trialEndsAt).getTime() < now.getTime()
  ) {
    return 'trial_expired'
  }

  return null
}
