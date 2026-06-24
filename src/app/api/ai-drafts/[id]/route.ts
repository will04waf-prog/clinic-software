import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

/**
 * PATCH /api/ai-drafts/[id]
 *
 * Mark an AI draft as rejected (the user typed their own reply or
 * dismissed the suggestion). The send-sms route handles the 'sent'
 * and 'edited' transitions itself — this endpoint exists only for
 * the explicit "Discard" path.
 *
 * Body: { action: 'reject', reason?: string }
 *
 * Org isolation: re-check the draft belongs to the caller's org
 * before mutating (RLS on the table also enforces this; explicit
 * check makes the failure mode a clean 404).
 */

const PatchSchema = z.object({
  action: z.literal('reject'),
  reason: z.string().max(500).optional(),
})

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: draftId } = await params
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single()
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const parsed = PatchSchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }
  const { reason } = parsed.data

  const { data: draft } = await supabaseAdmin
    .from('ai_drafts')
    .select('id, organization_id, contact_id, state')
    .eq('id', draftId)
    .single()
  if (!draft) return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
  if (draft.organization_id !== profile.organization_id) {
    return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
  }
  if (draft.state !== 'pending') {
    return NextResponse.json({ ok: true, message: 'Draft already resolved.' })
  }

  const now = new Date().toISOString()
  await supabaseAdmin.from('ai_drafts').update({
    state:            'rejected',
    rejection_reason: reason ?? null,
    resolved_at:      now,
  }).eq('id', draftId).eq('state', 'pending')

  await supabase.from('activity_log').insert({
    organization_id: profile.organization_id,
    contact_id:      draft.contact_id,
    action:          'ai_draft_rejected',
    metadata: {
      draft_id: draftId,
      reason:   reason ?? null,
    },
  })

  return NextResponse.json({ ok: true })
}
