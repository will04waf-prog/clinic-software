/**
 * Durable enrollment queue.
 *
 * Replaces fire-and-forget `enrollContact(...).catch(...)` call sites so that
 * lead automations survive Vercel's serverless worker lifecycle. Handlers
 * call `enqueueEnrollment()` (awaited, cheap single INSERT) and return their
 * response. `/api/cron` drains the queue via `processEnrollmentJobs()`.
 *
 * Shadow/primary cutover is controlled by ENROLLMENT_JOBS_MODE.
 */
import { supabaseAdmin } from '@/lib/supabase/admin'
import { enrollContact } from '@/lib/automation-engine'
import type { TriggerType } from '@/types'

const MAX_ATTEMPTS = 5
const DEFAULT_BATCH_SIZE = 25

export type EnrollmentJobsMode = 'shadow' | 'primary'

export function enrollmentJobsMode(): EnrollmentJobsMode {
  return process.env.ENROLLMENT_JOBS_MODE === 'primary' ? 'primary' : 'shadow'
}

interface EnqueueOpts {
  organizationId: string
  contactId: string
  triggerType: TriggerType
  stageId?: string
}

export async function enqueueEnrollment(opts: EnqueueOpts): Promise<void> {
  const { error } = await supabaseAdmin.from('enrollment_jobs').insert({
    organization_id: opts.organizationId,
    contact_id: opts.contactId,
    trigger_type: opts.triggerType,
    stage_id: opts.stageId ?? null,
  })
  if (error) {
    // Intentionally log only the provider message, not the full error object.
    // PR3 (PHI-safe logger) replaces this with a redacting logger.
    console.error('[enrollment-jobs] enqueue failed:', error.message)
    throw error
  }
}

interface ProcessResult {
  picked: number
  processed: number
  failed: number
}

export async function processEnrollmentJobs(
  opts: { batchSize?: number } = {}
): Promise<ProcessResult> {
  const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE

  const { data: jobs, error: pickError } = await supabaseAdmin
    .from('enrollment_jobs')
    .select('id, organization_id, contact_id, trigger_type, stage_id, attempts')
    .eq('status', 'pending')
    .lte('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(batchSize)

  if (pickError || !jobs || jobs.length === 0) {
    return { picked: 0, processed: 0, failed: 0 }
  }

  let processed = 0
  let failed = 0

  for (const job of jobs) {
    // Atomic claim: only the first worker to flip status='pending'→'processing'
    // wins. Any concurrent cron tick on the same job is a no-op.
    const { data: claimed } = await supabaseAdmin
      .from('enrollment_jobs')
      .update({ status: 'processing', attempts: job.attempts + 1 })
      .eq('id', job.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle()

    if (!claimed) continue

    try {
      await enrollContact({
        contactId: job.contact_id,
        organizationId: job.organization_id,
        triggerType: job.trigger_type as TriggerType,
        stageId: job.stage_id ?? undefined,
      })

      await supabaseAdmin
        .from('enrollment_jobs')
        .update({
          status: 'processed',
          processed_at: new Date().toISOString(),
        })
        .eq('id', job.id)
      processed++
    } catch (err: unknown) {
      const nextAttempts = job.attempts + 1
      const terminal = nextAttempts >= MAX_ATTEMPTS
      const backoffMinutes = Math.min(2 ** nextAttempts, 30)
      const nextScheduledAt = new Date(
        Date.now() + backoffMinutes * 60 * 1000
      ).toISOString()

      const message =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message: unknown }).message).slice(0, 200)
          : String(err).slice(0, 200)

      await supabaseAdmin
        .from('enrollment_jobs')
        .update({
          status: terminal ? 'failed' : 'pending',
          last_error: message,
          scheduled_at: nextScheduledAt,
        })
        .eq('id', job.id)
      failed++
    }
  }

  return { picked: jobs.length, processed, failed }
}
