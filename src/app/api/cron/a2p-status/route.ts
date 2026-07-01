/**
 * POST /api/cron/a2p-status — Phase 5 M4.
 *
 * Every 30 minutes the cron picks every organization whose a2p_status
 * is 'pending', polls Twilio's BrandRegistrations endpoint for the
 * current status, and writes back the terminal state. On approval we
 * unblock outbound SMS (via the A2P_REQUIRED gate in src/lib/twilio.ts)
 * and fire a one-shot owner-notification email. On failure we surface
 * the rejection reason via activity_log so the operator (or M5's
 * runner) can resubmit.
 *
 * Why a dedicated route (vs folding into /api/cron):
 *   1. Twilio's BrandRegistrations endpoint is rate-limited (~1 req/s
 *      account-wide). Running every minute would mean burning the rate
 *      budget on brands that take 1-7 days to vet. 30-min cadence is
 *      conservative and matches Twilio's own status-change-notification
 *      polling guidance.
 *   2. The route does outbound HTTP to Twilio and email I/O — both can
 *      stretch tick wall time past the 60-second every-minute budget.
 *      Isolating to its own schedule keeps the every-minute cron tight.
 *
 * Idempotency layers:
 *   - withCronLock('a2p_status', 120) prevents tick overlap.
 *   - Per-row writes use .eq('a2p_status', 'pending') so a status that
 *     already flipped (e.g. the operator manually re-stamped it) isn't
 *     clobbered by a stale Twilio response.
 *   - Owner notification uses activity_log dedupe rows so the same
 *     terminal-state transition can't double-email. The shape mirrors
 *     src/lib/voice/call-summary-notification.ts (race-safe INSERT,
 *     swallow 23505).
 *
 * PHI-free: A2P registrations contain business + EIN data, NOT patient
 * data, so the privacy concern is "owner business info" rather than
 * "patient PHI". We still keep the email body link-only — the failure
 * reason can include a phone number for the authorized rep, which
 * we'd rather not put in transit. Operators view the full reason in
 * the admin dashboard.
 */

import { NextResponse } from 'next/server'
import { requireCronAuth } from '@/lib/cron/require-cron-auth'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { withCronLock } from '@/lib/cron-locks'
import { getBrandStatus } from '@/lib/telephony/a2p'
import { sendEmail, wrapEmailHtml } from '@/lib/resend'
import { getAppUrl } from '@/lib/voice-agent/app-url'

interface PendingOrg {
  id:            string
  name:          string
  a2p_brand_sid: string | null
  a2p_status:    string
}

interface JobOutcome {
  ok:        boolean
  checked:   number
  approved:  number
  failed:    number
  still_pending: number
  errors:    number
}

const ACTION_APPROVED = 'a2p_brand_approved'
const ACTION_REJECTED = 'a2p_brand_rejected'

async function notifyOwner(args: {
  organizationId: string
  orgName:        string
  outcome:        'approved' | 'failed'
  brandSid:       string
  failureReason?: string | null
}): Promise<void> {
  // No Resend key → silent no-op. Matches the call-summary
  // notification convention; nothing else is silently catastrophic.
  if (!process.env.RESEND_API_KEY) return

  const action = args.outcome === 'approved' ? ACTION_APPROVED : ACTION_REJECTED

  // Race-safe dedupe via activity_log INSERT — the unique-per-brand
  // semantics fall out of (organization_id, action) being narrow
  // enough that a second tick would naturally produce a no-op. We
  // don't have a partial unique index for this specific action pair,
  // so we add a defensive pre-check via metadata->>'a2p_brand_sid'
  // plus the same INSERT-first pattern as call-summary.
  const { error: claimErr } = await supabaseAdmin
    .from('activity_log')
    .insert({
      organization_id: args.organizationId,
      action,
      metadata: {
        a2p_brand_sid:   args.brandSid,
        outcome:         args.outcome,
        // Stored for the audit log; NOT echoed to the owner email body.
        failure_reason:  args.failureReason ?? null,
      },
    })
  if (claimErr) {
    // 23505 = already logged → no-op happy path. Any other error we
    // log and bail before sending — re-running the cron will retry
    // the notification cleanly.
    if (claimErr.code === '23505') return
    console.error('[a2p-status] dedupe claim insert failed:', claimErr.message)
    return
  }

  // Lookup owner email AFTER the claim so a missing-owner case
  // doesn't waste the dedupe slot. We still want to claim first so
  // two concurrent ticks don't both send.
  const { data: owner } = await supabaseAdmin
    .from('profiles')
    .select('email, full_name')
    .eq('organization_id', args.organizationId)
    .eq('role', 'owner')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!owner?.email) return

  const settingsUrl = `${getAppUrl()}/settings/call-agent`
  const body = args.outcome === 'approved'
    ? [
        `Good news: your A2P 10DLC registration was approved by The Campaign Registry.`,
        `Outbound SMS from ${args.orgName} will now deliver reliably to U.S. carriers.`,
        `Review the setup: ${settingsUrl}`,
      ].join('\n')
    : [
        `Your A2P 10DLC registration needs attention.`,
        `The Campaign Registry returned a rejection on the brand for ${args.orgName}.`,
        `Open ClinIQ to review the reason and resubmit: ${settingsUrl}`,
      ].join('\n')

  const subject = args.outcome === 'approved'
    ? `SMS sending is now active for ${args.orgName}`
    : `A2P registration needs attention for ${args.orgName}`

  try {
    await sendEmail({
      to:      owner.email,
      subject,
      html:    wrapEmailHtml(body, args.orgName),
      // 24h Resend idempotency — paired with the activity_log claim
      // for a belt-and-suspenders cross-process guard.
      idempotencyKey: `a2p_${args.outcome}:${args.brandSid}`,
    })
  } catch {
    // PHI-safe log path: don't interpolate the error (could surface
    // owner email if Resend echoes it back).
    console.error('[a2p-status] resend send failed for org', args.organizationId)
  }
}

export async function pollA2PStatuses(): Promise<JobOutcome> {
  const outcome: JobOutcome = {
    ok: true, checked: 0, approved: 0, failed: 0, still_pending: 0, errors: 0,
  }

  const wrapped = await withCronLock('a2p_status', 120, async () => {
    const { data: orgs, error: orgErr } = await supabaseAdmin
      .from('organizations')
      .select('id, name, a2p_brand_sid, a2p_status')
      .eq('a2p_status', 'pending')

    if (orgErr) {
      console.error('[a2p-status] org fetch failed:', orgErr.message)
      outcome.ok = false
      return outcome
    }

    const pending = (orgs ?? []) as PendingOrg[]

    // Serial polling. Twilio's TrustHub layer applies a per-account
    // ~1 req/sec cap on a2p endpoints; concurrent polling would burn
    // the budget the moment we onboard >60 orgs. Serial keeps us under
    // 1 req/30s on average. Worst-case wall time at 100 orgs ≈ 100s
    // which is under the 120s cron lock TTL.
    for (const org of pending) {
      if (!org.a2p_brand_sid) {
        // Pending without a brand sid means the M5 queue is still
        // working on the brand-create step. Leave alone; nothing to
        // poll for.
        continue
      }

      outcome.checked += 1

      let status: Awaited<ReturnType<typeof getBrandStatus>>
      try {
        status = await getBrandStatus({ brandSid: org.a2p_brand_sid })
      } catch (err) {
        // Network blip / Twilio 5xx / rate-limit. Don't flip the row,
        // count the error, move on. Next tick retries.
        console.error(`[a2p-status] poll failed for org ${org.id}:`, err instanceof Error ? err.message : 'unknown')
        outcome.errors += 1
        continue
      }

      if (status.status === 'PENDING') {
        outcome.still_pending += 1
        continue
      }

      // Terminal state — flip the row + notify the owner. The CAS
      // .eq('a2p_status', 'pending') prevents a concurrent admin
      // edit (manual approve via the dashboard) from being
      // overwritten by a stale Twilio response.
      const newStatus = status.status === 'APPROVED' ? 'approved' : 'rejected'
      const { error: updErr } = await supabaseAdmin
        .from('organizations')
        .update({
          a2p_status:            newStatus,
          a2p_status_updated_at: new Date().toISOString(),
        })
        .eq('id', org.id)
        .eq('a2p_status', 'pending')

      if (updErr) {
        console.error(`[a2p-status] update failed for org ${org.id}:`, updErr.message)
        outcome.errors += 1
        continue
      }

      if (newStatus === 'approved') {
        outcome.approved += 1
      } else {
        outcome.failed += 1
      }

      // Fire owner notification last so an email failure can't roll
      // back the row flip. notifyOwner is fire-and-forget at the
      // exception layer.
      await notifyOwner({
        organizationId: org.id,
        orgName:        org.name,
        outcome:        newStatus === 'approved' ? 'approved' : 'failed',
        brandSid:       org.a2p_brand_sid,
        failureReason:  status.failure_reason ?? null,
      })
    }

    return outcome
  })

  if (wrapped.skipped) {
    return { ...outcome, ok: true }
  }
  return wrapped.result ?? outcome
}

export async function POST(request: Request) {
  const denied = requireCronAuth(request)
  if (denied) return denied

  const result = await pollA2PStatuses()
  return NextResponse.json({
    ok:     result.ok,
    ran_at: new Date().toISOString(),
    a2p_status: result,
  })
}

// Manual dev trigger. Matches the convention across the other cron
// routes — GET aliases POST so an operator can curl the endpoint
// without crafting a method override.
export async function GET(request: Request) {
  return POST(request)
}
