/**
 * Phase 5 M6 — super-admin number-health dashboard.
 *
 * One row per organization with the at-a-glance signals we need to
 * spot a clinic whose phone-number provisioning has silently broken:
 *
 *   • phone-number assignment (E.164)
 *   • A2P 10DLC registration status (4-state badge)
 *   • Vapi-side phone-number binding (bound | unbound)
 *   • last inbound call / last outbound call
 *   • 30-day call count + 30-day SMS count
 *   • a "Re-trigger" button on broken rows that re-enqueues the right
 *     provisioning_jobs step (handled by ./actions.ts).
 *
 * Health bucket rules (from M6 spec):
 *
 *   HEALTHY: vapi_phone_number_id set AND a2p_status='approved' AND
 *            at least one call_logs row in the last 30 days.
 *   PENDING: any provisioning_jobs row in ('pending', 'in_progress').
 *   BROKEN:  a2p_status='rejected', OR (vapi_phone_number_id is NULL
 *            AND voice_reminder_enabled), OR stale (no call_logs row
 *            in the last 7 days while reminders are enabled).
 *
 * Bucket precedence (when multiple apply): PENDING > BROKEN > HEALTHY.
 * Rationale: if the queue is actively reconciling a row, the operator
 * shouldn't be nudged to re-trigger it manually — that's what causes
 * double-charges in TrustHub / Twilio. Show pending first; the broken-
 * row red dot returns the moment the job lands in 'failed'.
 *
 * Performance / N+1 note
 * ──────────────────────
 * This page does a small fan-out (one COUNT/MAX per org for call_logs,
 * sms_log, and provisioning_jobs). With <100 orgs that's ~6 round trips
 * per org × org_count, which is acceptable for an internal page hit by
 * one operator. If org count grows to thousands we should switch to
 * a single SQL view or RPC that aggregates everything in one shot.
 * Matches the same N+1 pattern as src/app/admin/accounts/page.tsx
 * (which is also unoptimized by design).
 *
 * Filtering
 * ─────────
 * The ?filter= search param drives both the chip highlight and the
 * row visibility. Counts on each chip are computed BEFORE filtering
 * so the chip set always shows totals. The 'all' chip omits the
 * search param entirely (cleaner URL).
 */

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { FilterChips, type NumberHealthFilter } from '@/components/admin/numbers/filter-chips'
import { NumberRow, type NumberRowData } from '@/components/admin/numbers/number-row'
import type { ProvisioningStep } from './actions'

// Server components do not type-narrow searchParams as nicely as we'd
// like — Next 15 passes them as a Promise, and the value type is a
// loose Record. We coerce inline at the top of the component.
type SearchParams = Promise<Record<string, string | string[] | undefined>>

const SEVEN_DAYS_MS  = 7  * 24 * 60 * 60 * 1000
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

type OrgInfo = {
  id:                            string
  name:                          string
  twilio_phone_number:           string | null
  vapi_phone_number_id:          string | null
  a2p_status:                    string
  voice_reminder_enabled:        boolean
  call_agent_enabled:            boolean
}

export default async function AdminNumbersPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  // Belt-and-suspenders super-admin re-check. The /admin layout
  // already gates this, but the action layer also re-checks, and we
  // re-check here too — admin pages are the one place in the app
  // where over-verification is the right tradeoff.
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('is_super_admin')
    .eq('id', user.id)
    .single()

  if (!profile?.is_super_admin) redirect('/dashboard')

  const sp = await searchParams
  const activeFilter: NumberHealthFilter =
    (sp.filter as NumberHealthFilter | undefined) ?? 'all'

  // ── 1. Pull every org's voice + provisioning columns ─────────
  const { data: orgs } = await supabaseAdmin
    .from('organizations')
    .select(`
      id,
      name,
      twilio_phone_number,
      vapi_phone_number_id,
      a2p_status,
      voice_reminder_enabled,
      call_agent_enabled
    `)
    .order('name', { ascending: true })

  const orgList: OrgInfo[] = (orgs ?? []) as unknown as OrgInfo[]

  const now           = Date.now()
  const sevenDaysAgo  = new Date(now - SEVEN_DAYS_MS).toISOString()
  const thirtyDaysAgo = new Date(now - THIRTY_DAYS_MS).toISOString()

  // ── 2. Per-org aggregation fan-out ────────────────────────────
  const rows: NumberRowData[] = await Promise.all(
    orgList.map(async (org): Promise<NumberRowData> => {
      // Latest inbound / outbound call (separate queries — Supabase's
      // select+order+limit doesn't compose into "give me both
      // extremes" in a single round trip, but parallel is fine).
      const [
        lastInRes,
        lastOutRes,
        calls30Res,
        sms30Res,
        provJobsRes,
      ] = await Promise.all([
        supabaseAdmin
          .from('call_logs')
          .select('started_at')
          .eq('organization_id', org.id)
          .eq('direction', 'inbound')
          .order('started_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabaseAdmin
          .from('call_logs')
          .select('started_at')
          .eq('organization_id', org.id)
          .eq('direction', 'outbound')
          .order('started_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabaseAdmin
          .from('call_logs')
          .select('*', { count: 'exact', head: true })
          .eq('organization_id', org.id)
          .gte('started_at', thirtyDaysAgo),
        supabaseAdmin
          .from('sms_log')
          .select('*', { count: 'exact', head: true })
          .eq('organization_id', org.id)
          .gte('sent_at', thirtyDaysAgo),
        supabaseAdmin
          .from('provisioning_jobs')
          .select('step, status')
          .eq('organization_id', org.id)
          .in('status', ['pending', 'in_progress']),
      ])

      const lastInboundAt  = lastInRes.data?.started_at  ?? null
      const lastOutboundAt = lastOutRes.data?.started_at ?? null
      const calls30d       = calls30Res.count ?? 0
      const sms30d         = sms30Res.count   ?? 0
      const hasPendingJob  = (provJobsRes.data?.length ?? 0) > 0

      // ── Compute health bucket + broken reasons ────────────────
      // Reasons array is human-readable; the row component renders
      // them comma-joined under the org name when health='broken'.
      const reasons: string[] = []

      const a2pRejected   = org.a2p_status === 'rejected'
      const noVapiBinding = !org.vapi_phone_number_id
      const stale =
        org.voice_reminder_enabled &&
        (!lastInboundAt || new Date(lastInboundAt).getTime() < now - SEVEN_DAYS_MS) &&
        (!lastOutboundAt || new Date(lastOutboundAt).getTime() < now - SEVEN_DAYS_MS)

      if (a2pRejected) reasons.push('A2P rejected')
      if (noVapiBinding && org.voice_reminder_enabled) {
        reasons.push('No Vapi binding (reminders on)')
      }
      if (stale && !noVapiBinding && !a2pRejected) {
        // Only flag stale when there isn't already a more specific
        // reason — "stale" on a clinic that also has no Vapi binding
        // is just noise.
        reasons.push('No calls in 7d')
      }

      const a2pApproved      = org.a2p_status === 'approved'
      const hadCalls30d      = calls30d > 0
      const isHealthy        = !!org.vapi_phone_number_id && a2pApproved && hadCalls30d
      const isBrokenIntrinsic = a2pRejected || (noVapiBinding && org.voice_reminder_enabled) || stale

      // Pending wins over broken — see header doc.
      let health: 'healthy' | 'pending' | 'broken'
      if (hasPendingJob) {
        health = 'pending'
      } else if (isBrokenIntrinsic) {
        health = 'broken'
      } else if (isHealthy) {
        health = 'healthy'
      } else {
        // Mid-state: no pending job, not broken, but not yet HEALTHY
        // (e.g. a fresh org that hasn't received any calls yet but
        // also isn't enabled for reminders). Render as 'pending' so
        // the operator can see something's mid-flight.
        health = 'pending'
      }

      // Pick the right step to re-enqueue when broken. Order matches
      // the natural provisioning sequence: you can't register the
      // Vapi phone resource until you've bought the Twilio number,
      // and you can't run an A2P campaign until the brand is approved.
      let suggestedStep: ProvisioningStep | null = null
      if (health === 'broken') {
        if (noVapiBinding) {
          // No Twilio number at all → start from the top.
          suggestedStep = org.twilio_phone_number
            ? 'register_vapi_phone'
            : 'buy_twilio_number'
        } else if (a2pRejected) {
          suggestedStep = 'register_a2p_brand'
        } else if (stale) {
          // Stale-but-bound is more likely a Vapi-side disconnect.
          // Re-running the phone-binding step is cheap (idempotent
          // GET-by-number recovery already in M1) and is the right
          // first move for an ops re-trigger.
          suggestedStep = 'register_vapi_phone'
        }
      }

      return {
        orgId:                org.id,
        orgName:              org.name,
        e164:                 org.twilio_phone_number,
        vapiPhoneNumberId:    org.vapi_phone_number_id,
        a2pStatus:            org.a2p_status,
        voiceReminderEnabled: org.voice_reminder_enabled,
        lastInboundAt,
        lastOutboundAt,
        calls30d,
        sms30d,
        health,
        brokenReasons:        reasons,
        suggestedStep,
      }
    })
  )

  // ── 3. Chip counts (pre-filter, all orgs) ─────────────────────
  const counts: Record<NumberHealthFilter, number> = {
    all:          rows.length,
    healthy:      rows.filter((r) => r.health === 'healthy').length,
    pending:      rows.filter((r) => r.health === 'pending').length,
    a2p_pending:  rows.filter((r) => r.a2pStatus === 'pending').length,
    a2p_failed:   rows.filter((r) => r.a2pStatus === 'rejected').length,
    stale:        rows.filter((r) => r.brokenReasons.includes('No calls in 7d')).length,
    missing_vapi: rows.filter((r) => !r.vapiPhoneNumberId).length,
  }

  // ── 4. Apply the active filter ────────────────────────────────
  const visible = rows.filter((r) => {
    switch (activeFilter) {
      case 'all':          return true
      case 'healthy':      return r.health === 'healthy'
      case 'pending':      return r.health === 'pending'
      case 'a2p_pending':  return r.a2pStatus === 'pending'
      case 'a2p_failed':   return r.a2pStatus === 'rejected'
      case 'stale':        return r.brokenReasons.includes('No calls in 7d')
      case 'missing_vapi': return !r.vapiPhoneNumberId
      default:             return true
    }
  })

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Number health</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {rows.length} clinic{rows.length === 1 ? '' : 's'} ·{' '}
          {counts.healthy} healthy · {counts.pending} pending ·{' '}
          {rows.filter((r) => r.health === 'broken').length} broken
        </p>
      </div>

      <div className="mb-4">
        <FilterChips counts={counts} />
      </div>

      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Clinic</th>
              <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Phone</th>
              <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">A2P</th>
              <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Vapi</th>
              <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Last inbound</th>
              <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Last outbound</th>
              <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Calls 30d</th>
              <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">SMS 30d</th>
              <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {visible.length === 0 && (
              <tr>
                <td colSpan={9} className="px-5 py-8 text-center text-sm text-gray-400">
                  No clinics match this filter
                </td>
              </tr>
            )}
            {visible.map((row) => (
              <NumberRow key={row.orgId} row={row} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
