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

  // role='owner' AND is_active=true mirrors the tightened RLS policy
  // from migration 20260712090000_tighten_voice_messages_rls — an
  // owner who has been deactivated (terminated, locked out) must not
  // be able to resolve/reopen voicemails behind the policy's back via
  // the server-action layer. The two checks must move in lockstep
  // with the policy or the action becomes a quiet bypass.
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, organization_id, is_active')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'owner' || profile?.is_active !== true) {
    return { ok: false, error: 'not_owner' }
  }

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

  // role='owner' AND is_active=true mirrors the tightened RLS policy
  // from migration 20260712090000_tighten_voice_messages_rls — an
  // owner who has been deactivated (terminated, locked out) must not
  // be able to resolve/reopen voicemails behind the policy's back via
  // the server-action layer. The two checks must move in lockstep
  // with the policy or the action becomes a quiet bypass.
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, organization_id, is_active')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'owner' || profile?.is_active !== true) {
    return { ok: false, error: 'not_owner' }
  }

  const { error } = await supabase
    .from('voice_messages')
    .update({ status: 'open' })
    .eq('id', messageId)
    .eq('organization_id', profile.organization_id as string)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/voice-messages')
  return { ok: true }
}
