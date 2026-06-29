/**
 * Phase 5 M7 — Metered-billing event ledger + Stripe pass-through.
 *
 * Two public surfaces:
 *
 *   recordUsage()         — INSERT a row into usage_events. Called from
 *                           the Vapi call-end webhook, sendSMS(), and the
 *                           phone-number provisioning step. Idempotent on
 *                           (organization_id, kind, source_ref): a retried
 *                           call-end webhook for the same call_sid silently
 *                           no-ops at the DB layer (see migration
 *                           20260715090000 for the unique partial index).
 *
 *   reportUsageToStripe() — Daily 02:00 UTC cron. Aggregates ungated rows
 *                           (reported_to_stripe_at IS NULL) per (org, kind),
 *                           submits to Stripe via billing.meterEvents.create
 *                           — which is the modern equivalent of the old
 *                           subscriptionItem.usageRecords.create() API
 *                           that the SDK shipped before pinning to
 *                           apiVersion 2026-03-25.dahlia. Stamps
 *                           reported_to_stripe_at + stripe_usage_record_id
 *                           on every row that was successfully passed
 *                           through.
 *
 * ── Feature-flag stance ───────────────────────────────────────────────
 *
 * Three env vars gate per-kind reporting:
 *   STRIPE_PHONE_NUMBER_PRICE_ID  — phone_number_rent
 *   STRIPE_VOICE_OVERAGE_PRICE_ID — voice_minute
 *   STRIPE_SMS_OVERAGE_PRICE_ID   — sms_segment
 *
 * When ANY of these is missing, reportUsageToStripe LOGS a warning and
 * NO-OPS for that kind. Default — all three off — usage_events are
 * still recorded (audit trail) but never reported. This is deliberate:
 * we want 30 days of usage data in the table before flipping billing
 * on, to size the meter ceiling without surprising customers.
 *
 * ── Why meterEvents instead of usageRecords ───────────────────────────
 *
 * Stripe deprecated the legacy subscriptionItem.usageRecords.create
 * API; the 2026-03-25.dahlia SDK no longer exposes it. The replacement
 * is stripe.billing.meterEvents.create(), which is event-based rather
 * than item-based — you POST a (customer, event_name, value) triple
 * and Stripe rolls it up against the Meter that's configured to listen
 * for that event_name. The Meter, in turn, is bound to the Price (the
 * STRIPE_*_PRICE_ID env vars). End result is the same line item on the
 * customer's invoice; the developer ergonomics are different.
 *
 * Implication for our code: we DON'T look up the subscription item by
 * price — we just post the meter event with the org's stripe_customer_id
 * and let Stripe's Meter aggregate it. That makes the flow stateless on
 * our side and removes the "what if this customer has 2 subscription
 * items with the same price" race that the legacy API would have hit.
 *
 * Identifier convention: we pass the usage_event row id as the meter
 * event identifier. Stripe enforces 24h-window uniqueness on identifier
 * so a retry within the dedupe window is a no-op even if our DB
 * stamping fails between the Stripe call and the UPDATE.
 *
 * ── Billing period bounds ─────────────────────────────────────────────
 *
 * recordUsage() defaults billing_period_start/end to the current
 * calendar month boundaries. The reporter doesn't actually CARE about
 * the period for meterEvents-based billing (the Meter does its own
 * aggregation by interval), but we keep the columns populated for
 * future flexibility and to enable in-app "this billing period"
 * dashboards that don't need to call Stripe.
 */

import { stripe } from '@/lib/stripe'
import { supabaseAdmin } from '@/lib/supabase/admin'

// ─── kind ↔ env-var ↔ Stripe meter event_name mapping ───────────────
//
// Centralised so the cron, the recorder, and the dashboard all read
// from one place. If you need a new metered dimension, extend the
// CHECK constraint on usage_events.kind in a NEW migration and add
// the matching entry here + the env var to .env.example.
//
// event_name values are the Stripe-side identifiers configured on the
// Meter dashboard. Use the kind verbatim for V1; later we may want
// distinct names per Stripe environment (test/live) but the SDK does
// not enforce naming so re-using the kind keeps the mapping trivial.

export type UsageKind = 'voice_minute' | 'sms_segment' | 'phone_number_rent'

interface KindConfig {
  /** The env var holding the Stripe Price ID. Presence gates reporting. */
  priceEnvVar: string
  /** Stripe Meter event_name to send. Stripe Meter is configured to bind this name to the Price. */
  eventName: string
  /** Human label for logs + dashboard rendering. */
  label: string
  /** Per-unit transformation before pushing to Stripe. ceil for fractional minutes. */
  toStripeUnits: (sum: number) => number
}

const KIND_CONFIG: Record<UsageKind, KindConfig> = {
  voice_minute: {
    priceEnvVar:   'STRIPE_VOICE_OVERAGE_PRICE_ID',
    eventName:     'voice_minute',
    label:         'Voice minutes',
    // Stripe meters accept floats, but charging fractional minutes on
    // an invoice is a UX trap (the patient sees "12.4 minutes" and
    // questions it). Ceil to whole minutes — slight over-bill in our
    // favour, but consistent with how telecom carriers report minutes.
    toStripeUnits: (sum) => Math.ceil(sum),
  },
  sms_segment: {
    priceEnvVar:   'STRIPE_SMS_OVERAGE_PRICE_ID',
    eventName:     'sms_segment',
    label:         'SMS segments',
    toStripeUnits: (sum) => Math.ceil(sum),
  },
  phone_number_rent: {
    priceEnvVar:   'STRIPE_PHONE_NUMBER_PRICE_ID',
    eventName:     'phone_number_rent',
    label:         'Phone numbers',
    toStripeUnits: (sum) => Math.ceil(sum),
  },
}

// ─── Internal helpers ─────────────────────────────────────────────────

function startOfMonthUTC(d: Date): string {
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth()
  // Date-only column on the DB side; YYYY-MM-DD is unambiguous.
  return `${y}-${String(m + 1).padStart(2, '0')}-01`
}

function endOfMonthUTC(d: Date): string {
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth()
  // Last day = day 0 of next month. Construct in UTC to avoid the
  // Date-stringification-uses-local-TZ trap that creates off-by-one
  // billing-period boundaries when the cron runs near midnight UTC.
  const last = new Date(Date.UTC(y, m + 1, 0))
  return `${last.getUTCFullYear()}-${String(last.getUTCMonth() + 1).padStart(2, '0')}-${String(last.getUTCDate()).padStart(2, '0')}`
}

// ─── recordUsage ──────────────────────────────────────────────────────

export interface RecordUsageArgs {
  organizationId: string
  kind:           UsageKind
  /** Raw quantity (e.g. 3.5 minutes, 1 SMS segment, 1 number provisioned). */
  quantity:       number
  /**
   * Free-form reference back to the originating row. ALWAYS supply
   * when called from a cron/webhook — that's the only way the DB
   * unique partial index can dedupe retries. Examples:
   *   voice_minute      → call_logs.call_sid
   *   sms_segment       → Twilio messages.sid (provider_id)
   *   phone_number_rent → `init:<orgid>` for the one-shot provisioning event
   */
  sourceRef?:     string
  /** Optional clock for tests. */
  now?:           Date
}

export async function recordUsage(args: RecordUsageArgs): Promise<{ recorded: boolean; reason?: string }> {
  if (!args.organizationId) {
    // Fail-quiet: usage tracking is best-effort audit and must never
    // bring down the calling code path (SMS send, call-end webhook,
    // provisioning). The warning lets us catch the gap in logs.
    console.warn('[metered-usage] recordUsage skipped: no organizationId')
    return { recorded: false, reason: 'no_org' }
  }
  if (!Number.isFinite(args.quantity) || args.quantity <= 0) {
    console.warn(`[metered-usage] recordUsage skipped: invalid quantity ${args.quantity} for kind=${args.kind}`)
    return { recorded: false, reason: 'invalid_quantity' }
  }

  const now = args.now ?? new Date()
  const periodStart = startOfMonthUTC(now)
  const periodEnd   = endOfMonthUTC(now)

  // Use upsert with onConflict to get idempotent insert on (org, kind,
  // source_ref). The partial unique index in migration 20260715090000
  // only covers source_ref IS NOT NULL — rows without a source_ref
  // fall through to a plain insert with no dedupe, which is the
  // correct behavior for the manual-adjustment escape hatch.
  if (args.sourceRef) {
    const { error } = await supabaseAdmin
      .from('usage_events')
      .upsert(
        {
          organization_id:      args.organizationId,
          kind:                 args.kind,
          quantity:             args.quantity,
          billing_period_start: periodStart,
          billing_period_end:   periodEnd,
          source_ref:           args.sourceRef,
        },
        {
          onConflict:          'organization_id,kind,source_ref',
          ignoreDuplicates:    true,
        },
      )
    if (error) {
      // Don't throw — usage tracking is best-effort. Log loudly so
      // the on-call dashboard can show "metering drift" if it sustains.
      console.error(`[metered-usage] upsert failed (org=${args.organizationId} kind=${args.kind}): ${error.message}`)
      return { recorded: false, reason: 'db_error' }
    }
    return { recorded: true }
  }

  // No source_ref → plain insert. Caller is responsible for whatever
  // dedup story they have on the source side.
  const { error } = await supabaseAdmin
    .from('usage_events')
    .insert({
      organization_id:      args.organizationId,
      kind:                 args.kind,
      quantity:             args.quantity,
      billing_period_start: periodStart,
      billing_period_end:   periodEnd,
      source_ref:           null,
    })
  if (error) {
    console.error(`[metered-usage] insert failed (org=${args.organizationId} kind=${args.kind}): ${error.message}`)
    return { recorded: false, reason: 'db_error' }
  }
  return { recorded: true }
}

// ─── reportUsageToStripe ──────────────────────────────────────────────

interface UsageEventRow {
  id:                    string
  organization_id:       string
  kind:                  UsageKind
  quantity:              number
  source_ref:            string | null
}

interface OrgRow {
  id:                      string
  stripe_customer_id:      string | null
  stripe_subscription_id:  string | null
  plan_status:             string | null
}

export interface ReportUsageOutcome {
  ok:                  boolean
  orgs_scanned:        number
  orgs_with_usage:     number
  orgs_skipped_no_sub: number
  events_total:        number
  events_reported:     number
  events_skipped_flag: number
  events_failed:       number
  // Per-kind detail useful for the cron response body.
  by_kind: Record<UsageKind, {
    events:       number
    sum_quantity: number
    reported:     boolean
    skip_reason?: string
  }>
}

function emptyByKind(): ReportUsageOutcome['by_kind'] {
  return {
    voice_minute:      { events: 0, sum_quantity: 0, reported: false },
    sms_segment:       { events: 0, sum_quantity: 0, reported: false },
    phone_number_rent: { events: 0, sum_quantity: 0, reported: false },
  }
}

export async function reportUsageToStripe(asOf: Date = new Date()): Promise<ReportUsageOutcome> {
  const outcome: ReportUsageOutcome = {
    ok: true,
    orgs_scanned:        0,
    orgs_with_usage:     0,
    orgs_skipped_no_sub: 0,
    events_total:        0,
    events_reported:     0,
    events_skipped_flag: 0,
    events_failed:       0,
    by_kind:             emptyByKind(),
  }

  // Pull every org that has any unreported usage. The partial index
  // (usage_events_unreported_idx) keeps this fast as the table grows.
  // We join through usage_events.organization_id rather than scanning
  // all orgs because most orgs won't have usage on a given day.
  const { data: rows, error } = await supabaseAdmin
    .from('usage_events')
    .select('id, organization_id, kind, quantity, source_ref')
    .is('reported_to_stripe_at', null)
    // Bound the report to events whose billing period has BEGUN.
    // Defensive — billing_period_start is always <= now() at insert
    // time today, but if a future kind starts back-dating we want the
    // safety rail.
    .lte('billing_period_start', asOf.toISOString().slice(0, 10))

  if (error) {
    console.error('[metered-usage] usage_events fetch failed:', error.message)
    outcome.ok = false
    return outcome
  }

  const events = (rows ?? []) as UsageEventRow[]
  outcome.events_total = events.length
  if (events.length === 0) {
    return outcome
  }

  // Group by org.
  const byOrg = new Map<string, UsageEventRow[]>()
  for (const ev of events) {
    const list = byOrg.get(ev.organization_id) ?? []
    list.push(ev)
    byOrg.set(ev.organization_id, list)
  }
  outcome.orgs_scanned = byOrg.size

  // Bulk-load the corresponding org rows so we know the stripe_customer_id
  // up front without N+1 round trips.
  const orgIds = Array.from(byOrg.keys())
  const { data: orgRows, error: orgErr } = await supabaseAdmin
    .from('organizations')
    .select('id, stripe_customer_id, stripe_subscription_id, plan_status')
    .in('id', orgIds)
  if (orgErr) {
    console.error('[metered-usage] organizations fetch failed:', orgErr.message)
    outcome.ok = false
    return outcome
  }
  const orgIndex = new Map<string, OrgRow>(
    ((orgRows ?? []) as OrgRow[]).map(o => [o.id, o]),
  )

  // Per-kind feature-flag check, evaluated ONCE per cron tick. If any
  // env var is missing we skip that kind globally and stamp the
  // outcome.by_kind so the cron response surfaces the gap.
  const priceIdByKind: Record<UsageKind, string | null> = {
    voice_minute:      process.env[KIND_CONFIG.voice_minute.priceEnvVar]      ?? null,
    sms_segment:       process.env[KIND_CONFIG.sms_segment.priceEnvVar]       ?? null,
    phone_number_rent: process.env[KIND_CONFIG.phone_number_rent.priceEnvVar] ?? null,
  }

  for (const kind of ['voice_minute', 'sms_segment', 'phone_number_rent'] as const) {
    if (!priceIdByKind[kind]) {
      console.warn(`[metered-usage] ${KIND_CONFIG[kind].priceEnvVar} not set — skipping ${kind} reporting; usage rows remain unreported for re-attempt after env flip`)
      outcome.by_kind[kind].skip_reason = 'price_env_missing'
    }
  }

  // Process per org.
  for (const [orgId, orgEvents] of byOrg) {
    const org = orgIndex.get(orgId)
    if (!org) {
      // Org row vanished between fetch and reporter — RLS doesn't bite
      // here (we're service-role), so this is genuinely a deleted org.
      // Skip the events; they'll fail to insert again because of the
      // ON DELETE CASCADE on the FK, but we don't need to fail the
      // whole cron over it.
      console.warn(`[metered-usage] org ${orgId} has usage events but no org row — skipping`)
      continue
    }

    // No active subscription = no metering. We still leave the rows
    // unreported so an org that subscribes mid-month can be invoiced
    // for the back-fill (Stripe meter accepts events within a 35-day
    // window) once the cron runs after the subscription lands.
    if (!org.stripe_customer_id) {
      outcome.orgs_skipped_no_sub += 1
      continue
    }

    outcome.orgs_with_usage += 1

    // Aggregate this org's events per kind.
    const perKind: Record<UsageKind, { rows: UsageEventRow[]; sum: number }> = {
      voice_minute:      { rows: [], sum: 0 },
      sms_segment:       { rows: [], sum: 0 },
      phone_number_rent: { rows: [], sum: 0 },
    }
    for (const ev of orgEvents) {
      perKind[ev.kind].rows.push(ev)
      perKind[ev.kind].sum += Number(ev.quantity)
    }

    for (const kind of ['voice_minute', 'sms_segment', 'phone_number_rent'] as const) {
      const bucket = perKind[kind]
      if (bucket.rows.length === 0) continue

      outcome.by_kind[kind].events       += bucket.rows.length
      outcome.by_kind[kind].sum_quantity += bucket.sum

      if (!priceIdByKind[kind]) {
        // Flag off — count for outcome but don't stamp reported. Rows
        // stay in usage_events with reported_to_stripe_at=NULL so a
        // later cron run (after the env flip) picks them up.
        outcome.events_skipped_flag += bucket.rows.length
        continue
      }

      // Emit ONE meter event per usage_event row. Aggregating into a
      // single (event_name, customer, sum) call would be cheaper, but
      // meterEvents.identifier-based dedup is per-event, so emitting
      // one-per-row gives us a clean retry story: if the cron crashes
      // mid-batch and re-runs, Stripe rejects the dup identifier
      // (24h window) and we just re-stamp reported_to_stripe_at.
      const cfg = KIND_CONFIG[kind]
      let reportedIds: string[] = []
      for (const ev of bucket.rows) {
        const unitsForThisRow = cfg.toStripeUnits(Number(ev.quantity))
        if (unitsForThisRow <= 0) {
          // Round-down landed on zero (e.g. a 0.4-min "voice_minute"
          // row from a missed-call dial). Stamp as reported so we
          // don't re-process it forever, but don't push to Stripe.
          reportedIds.push(ev.id)
          continue
        }
        try {
          const meterEvent = await stripe.billing.meterEvents.create({
            event_name: cfg.eventName,
            // Payload values MUST be strings per the Stripe SDK type.
            payload: {
              stripe_customer_id: org.stripe_customer_id!,
              value:              String(unitsForThisRow),
            },
            // Identifier provides 24h dedup on the Stripe side. Using
            // the row UUID gives us a stable identifier across retries
            // — if our cron crashes after the meterEvents.create call
            // but before the UPDATE stamps reported_to_stripe_at, the
            // next tick re-sends and Stripe rejects the dup quietly.
            identifier: ev.id,
          })

          // Stamp the row immediately so a crash mid-loop doesn't
          // leave a long tail of un-stamped already-reported rows.
          const { error: stampErr } = await supabaseAdmin
            .from('usage_events')
            .update({
              reported_to_stripe_at:  new Date().toISOString(),
              stripe_usage_record_id: meterEvent.identifier ?? null,
            })
            .eq('id', ev.id)
          if (stampErr) {
            console.error(`[metered-usage] stamp failed for usage_event ${ev.id}: ${stampErr.message}`)
            outcome.events_failed += 1
            continue
          }
          reportedIds.push(ev.id)
          outcome.events_reported += 1
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err)
          console.error(`[metered-usage] meterEvents.create failed for org=${orgId} kind=${kind} row=${ev.id}: ${msg}`)
          outcome.events_failed += 1
          // Leave the row un-stamped so the next cron retries it.
          // 35-day Stripe back-fill window is the upper bound on how
          // long we can keep retrying before we lose the period.
        }
      }
      if (reportedIds.length > 0) {
        outcome.by_kind[kind].reported = true
      }
    }
  }

  return outcome
}
