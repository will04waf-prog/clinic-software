/**
 * Per-tenant client-messaging kill switch — shared-sender insurance.
 *
 * All tenants message customers through ONE platform WhatsApp/SMS
 * number, so one spamming tenant degrades deliverability for everyone
 * (Meta quality rating, carrier filtering, customer blocks). This
 * switch lets the super-admin cut a single tenant's CLIENT-facing
 * sends in seconds — without touching the platform sender or the
 * tenant's owner-bound alerts (the tenant still hears from us; their
 * customers stop hearing from them).
 *
 * Enforced at every client-send chokepoint:
 *   - notifyClient (templates: estimate send/approve, review request,
 *     review reminder cron)
 *   - the WhatsApp inbox composer (freeform)
 *   - handleReviewReply (freeform review link / issue ack)
 *
 * Fail-open on query error: a transient DB hiccup must not silently
 * stop every tenant's messaging — the switch is the exception, not
 * the default.
 */
import { supabaseAdmin } from '@/lib/supabase/admin'

export async function clientMessagingBlocked(orgId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('organizations')
    .select('client_messaging_blocked_at')
    .eq('id', orgId)
    .maybeSingle()
  if (error) {
    console.error('[kill-switch] lookup failed (failing open):', error.message)
    return false
  }
  return Boolean(data?.client_messaging_blocked_at)
}
