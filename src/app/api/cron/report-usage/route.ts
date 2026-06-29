/**
 * POST /api/cron/report-usage — Phase 5 M7.
 *
 * Daily 02:00 UTC. Aggregates yesterday's (and older un-stamped)
 * usage_events rows per (org, kind) and submits them to Stripe via
 * billing.meterEvents.create. Stamps reported_to_stripe_at +
 * stripe_usage_record_id on every row that goes through.
 *
 * Why 02:00 UTC:
 *   - Late enough that any straggling call-end webhooks from the
 *     previous day's late-night calls have landed (Vapi has been
 *     observed to be up to ~10 min behind realtime).
 *   - Early enough that orgs in west-coast US (UTC-8) see the cron
 *     run before their morning, so the dashboard's "today" numbers
 *     are settled by the time staff open the app.
 *   - Doesn't conflict with the existing voice-reminders cron
 *     (runs at minute 0 of every hour) — they share the 02:00 hour
 *     but the voice-reminders cron is a 5-min job and the lock
 *     keying is disjoint so there's no contention.
 *
 * Lock key: 'report_usage'. TTL 600s (10 min) which is well above
 * the expected wall time (a single org with 1000 events makes ~1000
 * round trips to Stripe at ~50ms each = 50s) but well below the 24h
 * cron interval so a crashed run unblocks itself the next day.
 *
 * Manual triggering:
 *   GET aliases POST for the same CRON_SECRET-gated invocation
 *   pattern used by /api/cron/voice-reminders. Useful when you want
 *   to force-flush events before checking the dashboard.
 *
 * Note about feature flags:
 *   reportUsageToStripe() handles the per-kind STRIPE_*_PRICE_ID
 *   absence internally — if any of the three env vars is missing,
 *   that kind's events stay UN-STAMPED (reported_to_stripe_at=NULL).
 *   This is intentional: we collect usage rows for 30 days BEFORE
 *   flipping billing on, sizing the meter ceiling from real data.
 *   The cron response surfaces the skip count so the operator can
 *   see "still un-billed" without a DB query.
 */

import { NextResponse } from 'next/server'
import { withCronLock } from '@/lib/cron-locks'
import { reportUsageToStripe } from '@/lib/billing/metered-usage'

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = request.headers.get('authorization')
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  // TTL 600s. The actual wall time is dominated by the number of
  // Stripe round trips (one per usage_event row, see metered-usage.ts
  // comment about why we don't aggregate). At launch volumes (single
  // digits of orgs) the cron finishes in under a minute; the 10 min
  // TTL is headroom for the long tail.
  const wrapped = await withCronLock('report_usage', 600, async () => {
    return await reportUsageToStripe(new Date())
  })

  if (wrapped.skipped) {
    return NextResponse.json({
      ok:     true,
      skipped: true,
      reason: 'lock_held',
      ran_at: new Date().toISOString(),
    })
  }

  return NextResponse.json({
    ok:           wrapped.result?.ok ?? true,
    ran_at:       new Date().toISOString(),
    report_usage: wrapped.result,
  })
}

// Manual trigger during dev / on-call. Matches the existing
// /api/cron/* convention.
export async function GET(request: Request) {
  return POST(request)
}
