/**
 * Cron mutual-exclusion wrapper.
 *
 * Gates cron functions that are not yet fully idempotent against
 * concurrent Vercel Cron ticks. Backed by public.cron_locks +
 * try_cron_lock() / release_cron_lock() RPCs (see the migration at
 * supabase/migrations/20260421042333_add_cron_locks.sql).
 *
 * This is a stopgap: it prevents *overlapping* ticks from both
 * running the same function body. It does NOT fix the intra-function
 * send-then-update race — that requires row-level atomic claim
 * (tracked as PR-FU-1 / PR-FU-2).
 */
import { supabaseAdmin } from '@/lib/supabase/admin'

export interface CronLockOutcome<T> {
  skipped: boolean
  result?: T
}

export async function withCronLock<T>(
  key: string,
  ttlSeconds: number,
  fn: () => Promise<T>
): Promise<CronLockOutcome<T>> {
  const { data: acquired, error: acquireError } = await supabaseAdmin.rpc(
    'try_cron_lock',
    { p_key: key, p_ttl_seconds: ttlSeconds }
  )

  if (acquireError) {
    console.error(`[cron-lock] acquire failed for ${key}:`, acquireError.message)
    throw acquireError
  }

  if (!acquired) {
    console.info(`[cron-lock] skipping ${key}: lock held`)
    return { skipped: true }
  }

  console.debug(`[cron-lock] acquired ${key}`)

  try {
    const result = await fn()
    return { skipped: false, result }
  } finally {
    try {
      const { error: releaseError } = await supabaseAdmin.rpc(
        'release_cron_lock',
        { p_key: key }
      )
      if (releaseError) {
        console.error(`[cron-lock] release failed for ${key}:`, releaseError.message)
      }
    } catch (releaseErr: unknown) {
      // Release failure must not mask fn's outcome. TTL covers correctness.
      const msg = releaseErr instanceof Error ? releaseErr.message : String(releaseErr)
      console.error(`[cron-lock] release exception for ${key}:`, msg)
    }
  }
}
