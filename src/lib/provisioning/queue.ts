/**
 * M5 — Provisioning queue primitives.
 *
 * Thin, mutation-only wrapper around public.provisioning_jobs (the
 * durable-retry queue table introduced in M1's migration). Three
 * lifecycle verbs (enqueue / claim / complete | fail) plus a deferred-
 * reschedule helper for steps that wait on EXTERNAL state (e.g. the
 * A2P brand approval landing in organizations.a2p_status). Everything
 * is service-role (RLS bypassed via supabaseAdmin) because the cron
 * worker is the only caller in production.
 *
 *   ─────────────────────────────────────────────────────────────────
 *   WHY NO `SELECT … FOR UPDATE SKIP LOCKED`?
 *   ─────────────────────────────────────────────────────────────────
 *   The spec calls for the classic Postgres queue pattern, and the
 *   migration's index on (status, created_at) WHERE status IN
 *   ('pending','in_progress') is sized for that query. supabase-js
 *   doesn't expose row-lock hints, and adding a Postgres function
 *   just to ship M5 is overkill — concurrency is already bounded by
 *   withCronLock('provisioning', 60) on the /api/cron/provisioning
 *   route, so the runner has at most one concurrent caller. Within
 *   that single caller, claim() uses a per-row compare-and-swap UPDATE
 *   ('pending' → 'in_progress' WHERE id=$1 AND status='pending') as
 *   the atomic claim, which is sufficient for the single-runner case
 *   and degrades gracefully if a second runner ever sneaks past the
 *   lock (loser of the race gets no row back, simply moves on).
 *
 *   ─────────────────────────────────────────────────────────────────
 *   WHY THE PARTIAL-UNIQUE INDEX MATTERS FOR ENQUEUE()
 *   ─────────────────────────────────────────────────────────────────
 *   provisioning_jobs_one_active_per_step_uniq covers (org, step)
 *   WHERE status IN ('pending','in_progress','succeeded'). That means
 *   a second enqueue while the prior attempt is still alive collides
 *   with 23505, while a previously-failed (status='failed') row is
 *   excluded from the index so re-enqueue after permanent failure
 *   just works without manual cleanup. enqueue() catches the 23505
 *   and returns the existing row id so callers can be naively
 *   idempotent (the onboarding wizard re-fires the same enqueue on
 *   every page load — see M3).
 */

import { supabaseAdmin } from '@/lib/supabase/admin'
import { alertOperator } from '@/lib/ops-alert'

export interface ProvisioningJob {
  id:              string
  organization_id: string
  step:            string
  status:          'pending' | 'in_progress' | 'succeeded' | 'failed'
  attempts:        number
  payload:         Record<string, unknown> | null
  last_error:      string | null
  created_at:      string
  updated_at:      string
  succeeded_at:    string | null
}

/**
 * After this many attempts, fail({retryable:true}) flips the row to
 * status='failed' instead of resetting to 'pending'. Five gives the
 * transient-Twilio-5xx case enough headroom (30+60+90+120+150s of
 * backoff = ~7min total) without burning a real failure into a
 * never-ending pending loop. Deferred returns (steps.ts) are NOT
 * counted as attempts — see reschedule() below.
 */
export const MAX_ATTEMPTS = 5

/** Truncate cap for last_error — long Twilio JSON errors otherwise
 *  blow up the super-admin UI rendering. */
const LAST_ERROR_CAP = 2000

export interface EnqueueArgs {
  organizationId: string
  step:           string
  payload?:       Record<string, unknown> | null
}

export interface EnqueueResult {
  jobId:         string
  alreadyExists: boolean
}

/**
 * Insert a fresh provisioning_jobs row in status='pending'. If the
 * (org, step) pair already has an active row (per the partial-unique
 * index) we catch the 23505, SELECT the existing id, and return it
 * with alreadyExists=true. Callers can treat this as a no-op.
 *
 * NOT idempotent against the failed→retry case by design: a failed
 * row stays failed; re-enqueue creates a NEW row whose attempts=0
 * counter is fresh. The old failed row remains for forensics.
 */
export async function enqueue(args: EnqueueArgs): Promise<EnqueueResult> {
  const { data, error } = await supabaseAdmin
    .from('provisioning_jobs')
    .insert({
      organization_id: args.organizationId,
      step:            args.step,
      payload:         args.payload ?? null,
    })
    .select('id')
    .single()

  if (!error && data) {
    return { jobId: data.id, alreadyExists: false }
  }

  // 23505 from provisioning_jobs_one_active_per_step_uniq. We do a
  // best-effort string match on the message AS WELL because the
  // postgrest error object's `code` field has historically been a
  // weak guarantee (sometimes returned as null on REST-layer errors).
  const isUniqueViolation =
    error?.code === '23505' ||
    /duplicate key|unique constraint/i.test(error?.message ?? '')

  if (isUniqueViolation) {
    const { data: existing, error: lookupErr } = await supabaseAdmin
      .from('provisioning_jobs')
      .select('id')
      .eq('organization_id', args.organizationId)
      .eq('step',            args.step)
      .in('status',          ['pending', 'in_progress', 'succeeded'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (lookupErr || !existing) {
      throw new Error(
        `enqueue: 23505 on (${args.organizationId}, ${args.step}) but lookup found no active row: ${lookupErr?.message ?? 'not found'}`
      )
    }
    return { jobId: existing.id, alreadyExists: true }
  }

  throw new Error(`enqueue failed: ${error?.message ?? 'unknown'}`)
}

export interface ClaimArgs {
  limit: number
}

/**
 * Atomically claim up to `limit` pending rows for processing.
 *
 * Two-phase to avoid the lack of FOR UPDATE SKIP LOCKED:
 *   1. SELECT pending rows ORDER BY created_at LIMIT (limit*3); filter
 *      client-side against the attempts*30s backoff window.
 *   2. For each filtered row, attempt an atomic CAS UPDATE
 *      ('pending' → 'in_progress' WHERE id=$1 AND status='pending').
 *      Rows where the CAS returns no row (concurrent claimer won the
 *      race) are silently dropped.
 *
 * Overfetch (limit*3) is the simplest hedge against the backoff
 * filter pruning too aggressively — a more conservative tick would
 * issue a second SELECT pass, but at limit=25 the overfetch is
 * effectively free against the partial index.
 */
export async function claim(args: ClaimArgs): Promise<ProvisioningJob[]> {
  const overfetch = Math.max(args.limit * 3, args.limit + 5)

  const { data: candidates, error } = await supabaseAdmin
    .from('provisioning_jobs')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(overfetch)
  if (error) throw new Error(`claim select failed: ${error.message}`)

  const now = Date.now()
  // Backoff: don't re-claim a row until attempts*30s has elapsed since
  // its last update. updated_at is touched by trigger on every status
  // flip, so a row that just failed (fail() set status='pending') has
  // updated_at = now() and waits attempts*30s before re-pickup. A
  // freshly-enqueued row has attempts=0 → no wait.
  //
  // attempts*30s grows linearly: 30,60,90,120,150s — the 5th retry
  // bumps total elapsed time past the cron's per-minute cadence
  // significantly, which is intentional. Real Twilio outages last
  // minutes; we want to back off into a window where they're more
  // likely to be over.
  const eligible = (candidates ?? []).filter((c) => {
    if (c.attempts === 0) return true
    const minWaitMs = c.attempts * 30_000
    return now - new Date(c.updated_at).getTime() > minWaitMs
  }).slice(0, args.limit)

  const claimed: ProvisioningJob[] = []
  for (const c of eligible) {
    const { data: row, error: claimErr } = await supabaseAdmin
      .from('provisioning_jobs')
      .update({
        status:   'in_progress',
        attempts: c.attempts + 1,
      })
      .eq('id',     c.id)
      .eq('status', 'pending') // CAS guard against concurrent claim
      .select('*')
      .maybeSingle()
    if (claimErr) {
      // A single bad row shouldn't poison the rest of the batch.
      // Logged and skipped — fail() can't run because we never owned
      // the row.
      console.error(`[provisioning-queue] CAS claim error on ${c.id}: ${claimErr.message}`)
      continue
    }
    if (row) claimed.push(row as ProvisioningJob)
  }
  return claimed
}

export interface CompleteArgs {
  jobId:    string
  payload?: Record<string, unknown> | null
}

/**
 * Mark a job succeeded. Optionally overwrites payload (steps can
 * stash result data — e.g. the Twilio SID or Vapi phone-number id —
 * onto the row for forensics, even though the org row is the source
 * of truth). last_error is cleared explicitly so a row that was
 * retryable-failed once and then succeeded doesn't show stale error
 * text in the admin dashboard.
 */
export async function complete(args: CompleteArgs): Promise<void> {
  const update: Record<string, unknown> = {
    status:       'succeeded',
    succeeded_at: new Date().toISOString(),
    last_error:   null,
  }
  if (args.payload !== undefined) update.payload = args.payload

  const { error } = await supabaseAdmin
    .from('provisioning_jobs')
    .update(update)
    .eq('id', args.jobId)
  if (error) throw new Error(`complete failed for ${args.jobId}: ${error.message}`)
}

export interface FailArgs {
  jobId:     string
  error:     string
  retryable: boolean
}

/**
 * Mark a job failed. If `retryable` AND we haven't hit MAX_ATTEMPTS,
 * resets status back to 'pending' with last_error populated — the
 * next claim() will pick it up after the attempts*30s backoff. Else
 * flips to 'failed' permanently (the partial-unique index excludes
 * 'failed' so a fresh enqueue of the same step is allowed).
 *
 * Caller is responsible for deciding whether an error is retryable:
 *   - Twilio 4xx (bad request) → not retryable (fix the input first).
 *   - Twilio 5xx, Vapi 5xx, network errors → retryable.
 *   - Unknown step name → not retryable (typo at enqueue time).
 */
export async function fail(args: FailArgs): Promise<void> {
  const { data: row, error: rowErr } = await supabaseAdmin
    .from('provisioning_jobs')
    .select('attempts, organization_id, step')
    .eq('id', args.jobId)
    .maybeSingle()
  if (rowErr || !row) {
    throw new Error(`fail: cannot load job ${args.jobId}: ${rowErr?.message ?? 'not found'}`)
  }

  const trimmed   = args.error.slice(0, LAST_ERROR_CAP)
  const exhausted = !args.retryable || row.attempts >= MAX_ATTEMPTS

  const { error: updErr } = await supabaseAdmin
    .from('provisioning_jobs')
    .update({
      status:     exhausted ? 'failed' : 'pending',
      last_error: trimmed,
    })
    .eq('id', args.jobId)
  if (updErr) {
    throw new Error(`fail update failed for ${args.jobId}: ${updErr.message}`)
  }

  // Terminal failure = a clinic's phone-number setup died after all
  // retries. The wizard stepper shows it, but the owner may have
  // closed the tab — the operator must hear about it unprompted.
  if (exhausted) {
    await alertOperator({
      key: `provisioning-exhausted:${row.organization_id}:${row.step}`,
      subject: `phone provisioning failed permanently: ${row.step}`,
      body: `Org ${row.organization_id} — step ${row.step} exhausted after ${row.attempts} attempts.\nLast error: ${trimmed.slice(0, 500)}\nRe-enqueue from the admin dashboard once the cause is fixed.`,
    })
  }
}

export interface RescheduleArgs {
  jobId:  string
  reason: string
}

/**
 * Push a claimed row back to 'pending' WITHOUT counting it as a
 * burned attempt. Used by steps that depend on EXTERNAL state which
 * resolves over a multi-day horizon (e.g. a2p_campaign_register
 * waiting for organizations.a2p_status to flip from 'pending' to
 * 'approved' — that flip lands via the M4 a2p-status poller, not
 * via the runner itself).
 *
 * Why decrement attempts: claim() increments attempts in the same CAS
 * UPDATE that marks the row in_progress. A deferred return undoes
 * that increment so the 5-attempt cap doesn't burn against external
 * waits — five minutes of brand-approval polling would otherwise
 * permanently fail a row that's genuinely fine.
 *
 * Why we don't bump backoff: the deferred check inside the handler
 * is a local SELECT on organizations.a2p_status, not a remote API
 * call, so polling once per cron tick (every minute) is cheap and
 * the latency-to-action is minimal once the brand is approved.
 */
export async function reschedule(args: RescheduleArgs): Promise<void> {
  const { data: row, error: rowErr } = await supabaseAdmin
    .from('provisioning_jobs')
    .select('attempts')
    .eq('id', args.jobId)
    .maybeSingle()
  if (rowErr || !row) {
    throw new Error(`reschedule: cannot load job ${args.jobId}: ${rowErr?.message ?? 'not found'}`)
  }
  const nextAttempts = Math.max(0, row.attempts - 1)

  const { error: updErr } = await supabaseAdmin
    .from('provisioning_jobs')
    .update({
      status:     'pending',
      attempts:   nextAttempts,
      last_error: args.reason.slice(0, LAST_ERROR_CAP),
    })
    .eq('id', args.jobId)
  if (updErr) {
    throw new Error(`reschedule failed for ${args.jobId}: ${updErr.message}`)
  }
}
