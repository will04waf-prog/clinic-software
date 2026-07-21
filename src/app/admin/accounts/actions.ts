'use server'

/**
 * Server actions for /admin/accounts/[id].
 *
 * toggleClientMessaging — the per-tenant kill switch on client-facing
 * sends (WhatsApp + SMS). All tenants share ONE platform sender, so a
 * spamming tenant degrades deliverability for everyone; this cuts a
 * single tenant off in seconds. Owner-bound alerts stay untouched.
 *
 * Authorization: super-admin only, same fail-closed pattern as
 * src/app/admin/numbers/actions.ts — cookie session for identity,
 * supabaseAdmin for the is_super_admin check and the write.
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

const toggleSchema = z.object({
  orgId: z.string().uuid(),
  block: z.boolean(),
  reason: z.string().trim().max(300).optional(),
})

export type ToggleMessagingResult = { ok: true; blocked: boolean } | { ok: false; error: string }

async function requireSuperAdmin(): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not authenticated' }

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('is_super_admin')
    .eq('id', user.id)
    .single()

  if (!profile?.is_super_admin) return { ok: false, error: 'Forbidden' }
  return { ok: true, userId: user.id }
}

export async function toggleClientMessaging(input: {
  orgId: string
  block: boolean
  reason?: string
}): Promise<ToggleMessagingResult> {
  const auth = await requireSuperAdmin()
  if (!auth.ok) return auth

  const parsed = toggleSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }
  const { orgId, block, reason } = parsed.data

  const { error } = await supabaseAdmin
    .from('organizations')
    .update({
      client_messaging_blocked_at: block ? new Date().toISOString() : null,
      client_messaging_blocked_reason: block ? (reason || 'blocked by admin') : null,
    })
    .eq('id', orgId)
  if (error) {
    console.error('[admin/toggleClientMessaging] update failed:', error.message)
    return { ok: false, error: 'Update failed' }
  }

  // Audit trail — who flipped it and which way.
  await supabaseAdmin.from('activity_log').insert({
    organization_id: orgId,
    action: 'client_messaging_toggled',
    metadata: { blocked: block, reason: reason ?? null, by_user_id: auth.userId },
  })

  revalidatePath(`/admin/accounts/${orgId}`)
  return { ok: true, blocked: block }
}
