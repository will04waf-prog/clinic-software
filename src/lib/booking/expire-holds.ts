/**
 * Sweep expired booking holds — Phase 4 W1.
 *
 * Called from the cron route every minute. Updates any consultation
 * row where state='hold' AND held_until < now() to state='canceled'
 * with cancel_reason='hold_expired'. Never deletes — preserves the
 * audit trail and lets W3 (AI Twin) explain to a patient why their
 * earlier hold lapsed.
 *
 * Idempotent: a second concurrent run sees the WHERE clause already
 * exclude the rows the first run flipped. Postgres row locking
 * handles the race; we still wrap in withCronLock for defense-in-
 * depth and to avoid wasted SQL under heavy schedules.
 *
 * Returns the count of rows expired so the cron handler can log it.
 */

import { supabaseAdmin } from '@/lib/supabase/admin'
import { withCronLock } from '@/lib/cron-locks'

const LOCK_KEY = 'booking_hold_sweep'
const LOCK_TTL_SECONDS = 120

export async function expireBookingHolds(): Promise<{ expired: number; skipped?: boolean }> {
  const outcome = await withCronLock(LOCK_KEY, LOCK_TTL_SECONDS, async () => {
    const nowIso = new Date().toISOString()
    // Update + return so we get an exact count without a second read.
    const { data, error } = await supabaseAdmin
      .from('consultations')
      .update({
        status: 'canceled',
        cancel_reason: 'hold_expired',
        hold_token: null,
        held_until: null,
        updated_at: nowIso,
      })
      .eq('status', 'hold')
      .lt('held_until', nowIso)
      .select('id')

    if (error) {
      console.error('[expire-holds] sweep failed:', error.message)
      return { expired: 0 }
    }
    const expired = data?.length ?? 0
    if (expired > 0) {
      console.info('[expire-holds] swept', expired, 'expired hold(s)')
    }
    return { expired }
  })

  if (outcome.skipped) return { expired: 0, skipped: true }
  return outcome.result ?? { expired: 0 }
}
