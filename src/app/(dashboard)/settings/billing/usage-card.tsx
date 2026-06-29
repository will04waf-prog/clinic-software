/**
 * Phase 5 M7 — Usage summary card (owner-facing).
 *
 * Reads this billing period's usage_events rows for the caller's org
 * and renders a three-row breakdown: voice minutes, SMS segments,
 * phone numbers. The component is a server component (RSC) so it can
 * hit supabaseAdmin directly without a fetch round-trip, which keeps
 * /settings/billing snappy even when the table grows.
 *
 * Why owner-facing only:
 *   The page that mounts this card MUST enforce owner-only access
 *   itself (proxy / page-level role check). Defense in depth lives at
 *   the RLS layer — usage_events_owner_read only returns rows to
 *   authenticated owners — but this component uses supabaseAdmin (RLS
 *   bypass) so the page-level guard is the actual gate.
 *
 * Why this card lives under /settings/billing (a directory that does
 * NOT yet exist as a page):
 *   The task spec calls for usage-card.tsx at this path with the
 *   understanding that the integration sweep will (a) create the
 *   /settings/billing page itself OR (b) mount this card on the
 *   existing /settings page. Either way the component is positioned
 *   to drop in without a path rewrite.
 *
 * What the card does NOT do:
 *   - No Stripe API calls. Reads only from usage_events. The Stripe
 *     pass-through happens in the daily cron; the card just shows what
 *     we'll bill (or what we WOULD bill once flags are flipped on).
 *   - No projections. We display current-period actuals only. A
 *     "projected at end-of-month" line is tempting but invites support
 *     tickets when the projection misses; skip until we have a month
 *     of real data.
 *   - No upgrade/downgrade CTAs. Those belong on the parent settings
 *     page; this card is purely a usage dashboard.
 *
 * Visual rules:
 *   - White card, rounded-xl, gray-200 border to match the rest of
 *     /settings (vs. the admin look's gray-50 internal-table chrome).
 *   - Each row: label, sub-label ("this billing period"), big number,
 *     unit. Mint dot when ANY usage has been reported to Stripe; gray
 *     dot otherwise. Mirrors the call-agent settings card's <Check />
 *     vocabulary for "this billing line is wired up live".
 *   - When ALL three kinds have zero rows, we still render the card
 *     with zeros — billing transparency is the whole point.
 */

import { supabaseAdmin } from '@/lib/supabase/admin'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface UsageCardProps {
  /** The org whose usage we render. Page is responsible for role-gating. */
  organizationId: string
}

interface AggregateRow {
  kind:                  'voice_minute' | 'sms_segment' | 'phone_number_rent'
  quantity:              number
  reported_to_stripe_at: string | null
}

type KindKey = AggregateRow['kind']

const KIND_LABELS: Record<KindKey, { label: string; unit: string; help: string }> = {
  voice_minute: {
    label: 'Voice minutes',
    unit:  'min',
    help:  'AI receptionist + outbound reminders. Charged per minute, ceiled.',
  },
  sms_segment: {
    label: 'SMS segments',
    unit:  'seg',
    help:  'Patient confirmations, reminders, and replies. One segment per send.',
  },
  phone_number_rent: {
    label: 'Phone numbers',
    unit:  '#',
    help:  'Monthly rent for each provisioned clinic line.',
  },
}

function startOfBillingMonthUTC(now: Date): string {
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth()
  return `${y}-${String(m + 1).padStart(2, '0')}-01`
}

export async function UsageCard({ organizationId }: UsageCardProps) {
  // We deliberately filter by billing_period_start = first day of the
  // current month rather than CURRENT_DATE BETWEEN start AND end —
  // recordUsage() stamps the period as full calendar months, so the
  // simpler equality matches the writer's intent and avoids a TZ
  // ambiguity at the boundary.
  const periodStart = startOfBillingMonthUTC(new Date())

  const { data, error } = await supabaseAdmin
    .from('usage_events')
    .select('kind, quantity, reported_to_stripe_at')
    .eq('organization_id', organizationId)
    .eq('billing_period_start', periodStart)
    .returns<AggregateRow[]>()

  if (error) {
    // Render a soft failure rather than throwing. The settings page
    // has other cards; usage is one row among many.
    return (
      <Card>
        <CardHeader>
          <CardTitle>Usage this billing period</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-gray-500">
            Could not load usage. Try refreshing in a few seconds.
          </p>
        </CardContent>
      </Card>
    )
  }

  // Aggregate per-kind sums + "any-row-reported" flag.
  const tally: Record<KindKey, { sum: number; reported: boolean }> = {
    voice_minute:      { sum: 0, reported: false },
    sms_segment:       { sum: 0, reported: false },
    phone_number_rent: { sum: 0, reported: false },
  }
  for (const row of data ?? []) {
    if (!(row.kind in tally)) continue
    const bucket = tally[row.kind]
    bucket.sum += Number(row.quantity)
    if (row.reported_to_stripe_at) bucket.reported = true
  }

  const now = new Date()
  const periodLabel = now.toLocaleDateString('en-US', {
    month: 'long',
    year:  'numeric',
    timeZone: 'UTC',
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Usage this billing period</CardTitle>
        <p className="text-sm text-gray-500">{periodLabel} (UTC) — updates within ~10 minutes of each event.</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {(['voice_minute', 'sms_segment', 'phone_number_rent'] as const).map((kind) => {
          const { sum, reported } = tally[kind]
          const meta = KIND_LABELS[kind]
          // ceil so the displayed number matches the value the daily
          // reporter will push to Stripe — see metered-usage.ts for
          // the matching toStripeUnits.
          const displayed = Math.ceil(sum)
          return (
            <div
              key={kind}
              className="flex items-start justify-between gap-4 rounded-lg border border-gray-100 bg-gray-50 px-4 py-3"
            >
              <div className="flex items-start gap-3">
                {/* Mint dot = at least one row has been reported to Stripe
                  * this period. Gray = nothing flushed yet. The dashboard
                  * uses the same vocabulary as the call-agent <Check />
                  * rows so owners learn the visual once. */}
                <span
                  className="mt-1.5 inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: reported ? '#02C39A' : '#D1D5DB' }}
                  aria-hidden
                />
                <div>
                  <div className="text-sm font-semibold text-[#14241d]">{meta.label}</div>
                  <div className="text-xs text-gray-500">{meta.help}</div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-semibold tabular-nums text-[#14241d]">
                  {displayed.toLocaleString('en-US')}
                </div>
                <div className="text-xs text-gray-500">{meta.unit}</div>
              </div>
            </div>
          )
        })}
        <p className="text-xs text-gray-400">
          Usage is recorded as events happen. Stripe billing pass-through runs daily at 02:00 UTC.
        </p>
      </CardContent>
    </Card>
  )
}
