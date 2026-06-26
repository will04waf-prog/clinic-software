/**
 * Phase 4 W9 — sweep expired team_invitations rows.
 *
 * Mirrors src/lib/booking/expire-holds.ts: cron-locked, idempotent,
 * UPDATEs in bulk and returns the count. team_invitations.expires_at
 * defaults to now() + 7 days at insert (W8 migration); without a
 * sweep, dead rows linger and inflate the W9 seat-cap pending count.
 *
 * Soft revoke (revoked_at = now()) rather than delete — preserves
 * the audit trail and lets the partial unique index on (org, email)
 * free up for fresh invitations.
 */

import { supabaseAdmin } from '@/lib/supabase/admin'
import { withCronLock } from '@/lib/cron-locks'

const LOCK_KEY = 'invitation_sweep'
const LOCK_TTL_SECONDS = 120

export async function expireInvitations(): Promise<{ expired: number; skipped?: boolean }> {
  const outcome = await withCronLock(LOCK_KEY, LOCK_TTL_SECONDS, async () => {
    const nowIso = new Date().toISOString()
    const { data, error } = await supabaseAdmin
      .from('team_invitations')
      .update({ revoked_at: nowIso })
      .is('accepted_at', null)
      .is('revoked_at',  null)
      .lt('expires_at',  nowIso)
      .select('id')

    if (error) {
      console.error('[expire-invitations] sweep failed:', error.message)
      return { expired: 0 }
    }
    const expired = data?.length ?? 0
    if (expired > 0) {
      console.info('[expire-invitations] swept', expired, 'expired invitation(s)')
    }
    return { expired }
  })

  if (outcome.skipped) return { expired: 0, skipped: true }
  return outcome.result ?? { expired: 0 }
}
