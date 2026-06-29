/**
 * POST /api/cron/provisioning — Phase 5 M5 provisioning runner.
 *
 * Drains public.provisioning_jobs (the durable retry queue M1
 * introduced). Each tick:
 *   1. Acquires withCronLock('provisioning', 60) so a slow tick can't
 *      overlap the next minute's tick — the queue's CAS UPDATE in
 *      claim() is also safe under concurrency, but the lock saves us
 *      from double-billing the same Twilio purchase if a step that
 *      already ran-but-didn't-mark-succeeded gets re-claimed.
 *   2. claim()s up to 25 pending rows in created_at order. Backoff
 *      filters out rows that recently failed (attempts*30s window).
 *   3. Dispatches each row through STEP_HANDLERS[job.step]. A handler
 *      returning {status:'ok'} → complete(); {status:'deferred'} →
 *      reschedule() (no attempt burned); a thrown error → fail() with
 *      retryable=true.
 *
 * Why a separate route + every-minute schedule instead of folding
 * into /api/cron:
 *   - The cost profile is fundamentally different. /api/cron runs 8
 *     low-latency DB-only jobs in parallel; this route synchronously
 *     hits Twilio + Vapi APIs and can take seconds per row. Sharing
 *     the same minutely tick risks blocking the SMS reminder pipeline
 *     on a Twilio timeout.
 *   - Easier to pause. Deleting the vercel.json entry for THIS route
 *     stops provisioning without affecting the rest of the cron fan-
 *     out.
 *
 * Auth follows the same opt-in CRON_SECRET pattern as the other
 * voice cron routes (voice-reminders, voice-reminder-staleness):
 * if the env var is set, require Bearer auth; if unset (dev), the
 * route is open. GET aliases POST for manual triggering during
 * development.
 *
 * Cron registration (added by the integration sweep, NOT by M5):
 *   { "path": "/api/cron/provisioning", "schedule": "* * * * *" }
 */

import { NextResponse } from 'next/server'
import { withCronLock } from '@/lib/cron-locks'
import {
  claim,
  complete,
  fail,
  enqueue,
  reschedule,
} from '@/lib/provisioning/queue'
import { STEP_HANDLERS, type StepName } from '@/lib/provisioning/steps'

/** Per-tick batch size. 25 is small enough that a worst-case-all-
 *  failing batch finishes within the 60s lock TTL (each Twilio /
 *  Vapi call should fall back to a timeout in <10s under normal
 *  conditions); large enough that a backlog drains in a few minutes
 *  rather than days. */
const CLAIM_LIMIT = 25

interface ProvisioningOutcome {
  ok:           boolean
  claimed:      number
  succeeded:    number
  failed:       number
  deferred:     number
  unknown_step: number
}

export async function runProvisioning(): Promise<ProvisioningOutcome> {
  const baseline: ProvisioningOutcome = {
    ok: true, claimed: 0, succeeded: 0, failed: 0, deferred: 0, unknown_step: 0,
  }

  const wrapped = await withCronLock('provisioning', 60, async () => {
    const outcome = { ...baseline }

    let jobs
    try {
      jobs = await claim({ limit: CLAIM_LIMIT })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[provisioning] claim failed:', msg)
      return { ...outcome, ok: false }
    }
    outcome.claimed = jobs.length

    // Sequential processing — parallelizing would let one slow
    // Twilio call hold up an entire batch, but it would also amplify
    // peak QPS against Twilio + Vapi. With CLAIM_LIMIT=25 and a 60s
    // lock TTL, sequential is comfortably within budget.
    for (const job of jobs) {
      const handler = STEP_HANDLERS[job.step as StepName]

      if (!handler) {
        // Unknown step name is almost always a typo at enqueue time.
        // Non-retryable so we don't loop forever; the row sits in
        // status='failed' for the operator to delete or rename.
        try {
          await fail({
            jobId:     job.id,
            error:     `unknown step: ${job.step}`,
            retryable: false,
          })
        } catch (e) {
          console.error(`[provisioning] fail() for unknown-step job ${job.id} errored:`, e)
        }
        outcome.unknown_step += 1
        continue
      }

      try {
        const result = await handler(job)

        if (result.status === 'deferred') {
          await reschedule({ jobId: job.id, reason: result.reason })
          outcome.deferred += 1
          continue
        }

        // Success path. Complete the row first so a failure to
        // enqueue the next step doesn't leave THIS one in-progress
        // forever — better to lose the "next step" enqueue (which
        // the operator can manually re-fire) than to strand the
        // current row.
        await complete({
          jobId:   job.id,
          payload: result.payload ?? job.payload,
        })
        outcome.succeeded += 1

        if (result.enqueueNext) {
          try {
            await enqueue({
              organizationId: job.organization_id,
              step:           result.enqueueNext.step,
              payload:        result.enqueueNext.payload ?? null,
            })
          } catch (e) {
            // Best-effort. The completed step is already 'succeeded';
            // a stale next-step enqueue can be re-fired by the
            // onboarding wizard or the operator. Log and move on.
            const msg = e instanceof Error ? e.message : String(e)
            console.error(`[provisioning] enqueueNext (${result.enqueueNext.step}) for org ${job.organization_id} failed: ${msg}`)
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        // All thrown errors are retryable by default. Step handlers
        // that KNOW their error is permanent (e.g. "no e164") still
        // throw — they exhaust attempts and convert to 'failed' the
        // same way a flaky Twilio API would. Sub-optimal but keeps
        // the API surface a single mode.
        try {
          await fail({ jobId: job.id, error: msg, retryable: true })
        } catch (e) {
          console.error(`[provisioning] fail() for job ${job.id} errored:`, e)
        }
        outcome.failed += 1
      }
    }

    return outcome
  })

  if (wrapped.skipped) {
    // Lock held by another tick — pure no-op (not a failure).
    return baseline
  }
  return wrapped.result ?? baseline
}

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = request.headers.get('authorization')
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const result = await runProvisioning()
  return NextResponse.json({
    ok:           result.ok,
    ran_at:       new Date().toISOString(),
    provisioning: result,
  })
}

// Manual trigger during dev. Matches the existing /api/cron pattern.
export async function GET(request: Request) {
  return POST(request)
}
