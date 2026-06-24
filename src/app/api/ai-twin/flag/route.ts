import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { requireCapability } from '@/lib/billing/require-tier'
import { FLAG_REASON_CODES } from '@/lib/ai-twin-audit'

/**
 * POST   /api/ai-twin/flag — flag an auto-sent AI draft as wrong.
 * DELETE /api/ai-twin/flag — undo a flag (idempotent).
 *
 * Only state='auto_sent' drafts are flaggable. Drafts that went out
 * via human review (sent / edited) already had a human approval, so
 * the regular ai_draft_rejected / ai_draft_edited signal applies —
 * flagging them here would double-count the retraining signal.
 *
 * Org isolation: we verify the target ai_draft row belongs to the
 * caller's org BEFORE writing. The unique partial index added in the
 * W11 migration enforces "one flag per (draft, user)" at the DB
 * level — when it fires we surface a 409 the UI renders as
 * "already flagged".
 *
 * The activity_log row this writes is mineable by the future W12
 * retraining job and by the W8 voice-health aggregator (a flagged
 * class is a signal to demote auto-send eligibility for that class).
 */

const PostBody = z.object({
  draft_id: z.string().uuid(),
  reason_code: z.enum(FLAG_REASON_CODES),
  reason_text: z.string().max(500).optional(),
})

const DeleteBody = z.object({
  draft_id: z.string().uuid(),
})

export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = await createClient()

  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single()
  if (!profile?.organization_id) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const orgId = profile.organization_id as string

  const gate = await requireCapability(supabase, orgId, 'allowsVoiceTraining')
  if (!gate.ok) return gate.response

  let parsed: z.infer<typeof PostBody>
  try {
    const json = await req.json()
    const result = PostBody.safeParse(json)
    if (!result.success) {
      return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 })
    }
    parsed = result.data
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 })
  }

  // ── Verify draft exists, belongs to caller's org, is auto_sent. ──
  // Selecting through the user-scoped client gives RLS-driven
  // existence-leak protection: a cross-org draft returns no row,
  // which we surface as 404 (same response shape as "not found"),
  // never leaking that the draft exists under another org.
  const { data: draft, error: draftErr } = await supabase
    .from('ai_drafts')
    .select('id, contact_id, state, context_snapshot, organization_id')
    .eq('id', parsed.draft_id)
    .eq('organization_id', orgId)
    .maybeSingle()

  if (draftErr) {
    console.error('[ai-twin/flag] ai_drafts lookup failed:', draftErr.message)
    return NextResponse.json({ ok: false, error: 'query_failed' }, { status: 500 })
  }
  if (!draft) {
    return NextResponse.json({ ok: false, error: 'draft_not_found' }, { status: 404 })
  }
  if (draft.state !== 'auto_sent') {
    return NextResponse.json({ ok: false, error: 'draft_not_auto_sent' }, { status: 422 })
  }

  const cs = (draft.context_snapshot ?? {}) as Record<string, unknown>
  const trigger_message_id =
    typeof cs['trigger_message_id'] === 'string' ? cs['trigger_message_id'] : null
  const message_class =
    (typeof cs['voice_class']      === 'string' ? (cs['voice_class']      as string) : null) ??
    (typeof cs['classified_class'] === 'string' ? (cs['classified_class'] as string) : null) ??
    null

  const reason_text = parsed.reason_text ? parsed.reason_text.slice(0, 500) : null

  const { data: inserted, error: insertErr } = await supabase
    .from('activity_log')
    .insert({
      organization_id: orgId,
      contact_id: draft.contact_id,
      user_id: user.id,
      action: 'ai_twin_auto_sent_flagged',
      metadata: {
        draft_id: draft.id,
        reason_code: parsed.reason_code,
        reason_text,
        flagged_by_user_id: user.id,
        trigger_message_id,
        message_class,
      },
    })
    .select('id')
    .single()

  if (insertErr) {
    // 23505 = unique-index violation. Maps to our "already flagged"
    // 409 contract — the partial unique index on
    // (metadata->>'draft_id', metadata->>'flagged_by_user_id') fires
    // when the same user tries to flag the same draft twice.
    if ((insertErr as { code?: string }).code === '23505') {
      return NextResponse.json({ ok: false, code: 'already_flagged' }, { status: 409 })
    }
    console.error('[ai-twin/flag] insert failed:', insertErr.message)
    return NextResponse.json({ ok: false, error: 'insert_failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, activity_log_id: inserted.id })
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const supabase = await createClient()

  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single()
  if (!profile?.organization_id) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const orgId = profile.organization_id as string

  const gate = await requireCapability(supabase, orgId, 'allowsVoiceTraining')
  if (!gate.ok) return gate.response

  let parsed: z.infer<typeof DeleteBody>
  try {
    const json = await req.json()
    const result = DeleteBody.safeParse(json)
    if (!result.success) {
      return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 })
    }
    parsed = result.data
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 })
  }

  // Idempotent delete: scoped by org + draft_id + the *current
  // user* as flagger. If no rows match (already unflagged, or another
  // user's flag), the request still returns 200 — the caller's
  // intent ("ensure I have no flag on this draft") is satisfied.
  const { error: delErr } = await supabase
    .from('activity_log')
    .delete()
    .eq('organization_id', orgId)
    .eq('action', 'ai_twin_auto_sent_flagged')
    .eq('metadata->>draft_id', parsed.draft_id)
    .eq('metadata->>flagged_by_user_id', user.id)

  if (delErr) {
    console.error('[ai-twin/flag] delete failed:', delErr.message)
    return NextResponse.json({ ok: false, error: 'delete_failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
