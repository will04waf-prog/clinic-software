import { supabaseAdmin } from '@/lib/supabase/admin'

/**
 * Flip plan_status from 'trial' → 'trial_expired' for any org
 * whose trial_ends_at has passed. Called by the daily cron.
 */
export async function expireTrials() {
  const { error } = await supabaseAdmin
    .from('organizations')
    .update({ plan_status: 'trial_expired', updated_at: new Date().toISOString() })
    .eq('plan_status', 'trial')
    .not('trial_ends_at', 'is', null)
    .lt('trial_ends_at', new Date().toISOString())

  if (error) {
    console.error('[expire-trials] Failed:', error.message)
    throw error
  }
}
