'use server'

/**
 * Server actions for the voice-messages inbox.
 *
 * Owner-only — the role check is enforced here because the
 * RLS policy on voice_messages alone would allow any authenticated
 * profile in the org (not just owners) to read/update. We keep RLS
 * as defense in depth but mirror the booking/cancel pattern of
 * asserting role at the API/action layer.
 */

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export async function markResolved(messageId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'unauthenticated' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, organization_id')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'owner') return { ok: false, error: 'not_owner' }

  const { error } = await supabase
    .from('voice_messages')
    .update({ status: 'resolved' })
    .eq('id', messageId)
    .eq('organization_id', profile.organization_id as string)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/voice-messages')
  return { ok: true }
}

export async function reopenMessage(messageId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'unauthenticated' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, organization_id')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'owner') return { ok: false, error: 'not_owner' }

  const { error } = await supabase
    .from('voice_messages')
    .update({ status: 'open' })
    .eq('id', messageId)
    .eq('organization_id', profile.organization_id as string)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/voice-messages')
  return { ok: true }
}
