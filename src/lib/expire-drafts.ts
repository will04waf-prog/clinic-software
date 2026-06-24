import { supabaseAdmin } from '@/lib/supabase/admin'

/**
 * Sweep pending AI drafts older than 24h to state='expired'. After a
 * day the conversation context has drifted enough that the draft is
 * stale — the lead has either replied to something else or the staff
 * has moved on. Cron calls this once a run; UPDATE with a state filter
 * is idempotent so Twilio-style retries are safe.
 */
export async function expireDrafts(): Promise<{ expired: number }> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const now = new Date().toISOString()

  const { data, error } = await supabaseAdmin
    .from('ai_drafts')
    .update({ state: 'expired', resolved_at: now })
    .eq('state', 'pending')
    .lt('generated_at', cutoff)
    .select('id')

  if (error) {
    console.error('[expire-drafts] Failed:', error.message)
    throw error
  }

  const expired = data?.length ?? 0
  console.info(`[expire-drafts] expired ${expired} drafts`)
  return { expired }
}
