import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import type { ImportUndoResponse } from '@/lib/types/import'

const UNDO_WINDOW_MS = 24 * 60 * 60 * 1000

const undoSchema = z.object({
  import_id: z.string().uuid(),
}).strict()

async function resolveOrgId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
) {
  const { data } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', userId)
    .single()
  return data?.organization_id ?? null
}

// ── POST /api/contacts/import/undo ───────────────────────────
export async function POST(req: NextRequest) {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const orgId = await resolveOrgId(supabase, user.id)
  if (!orgId) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  }

  const parsed = undoSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    const firstError = parsed.error.issues[0]
    return NextResponse.json({ error: firstError.message }, { status: 400 })
  }

  // ── Load & authorize the import ───────────────────────────
  const { data: imp, error: impErr } = await supabaseAdmin
    .from('contact_imports')
    .select('id, organization_id, status, started_at, completed_at')
    .eq('id', parsed.data.import_id)
    .single()

  if (impErr || !imp) {
    return NextResponse.json({ error: 'Import not found' }, { status: 404 })
  }
  if (imp.organization_id !== orgId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Undoable when the import is in a terminal-from-the-user's-POV state
  // (they've seen a success screen) OR when it's still processing but
  // the user cancelled from the wizard's partial-failure screen. A
  // 'failed' or 'undone' import is not re-undoable — those should be
  // cleaned up through a different path if needed.
  if (imp.status !== 'completed' && imp.status !== 'processing') {
    return NextResponse.json(
      { error: `Cannot undo: import is ${imp.status}, expected 'completed' or 'processing'.` },
      { status: 409 },
    )
  }

  // ── 24h window check ──────────────────────────────────────
  // For completed imports: measure from completed_at (clinic's mental
  // model: "undo within 24h of seeing the success screen").
  // For still-processing imports: fall back to started_at. In practice
  // a processing import is minutes old — the window is effectively the
  // same either way — but started_at is the only timestamp available.
  const referenceMs = new Date(imp.completed_at ?? imp.started_at).getTime()
  if (Date.now() - referenceMs > UNDO_WINDOW_MS) {
    return NextResponse.json(
      { error: 'Undo window has expired (24h limit).' },
      { status: 410 },
    )
  }

  // ── Soft-delete every active contact tagged with this import ─
  const nowIso = new Date().toISOString()
  const { data: undone, error: undoErr } = await supabaseAdmin
    .from('contacts')
    .update({ deleted_at: nowIso })
    .eq('import_id', imp.id)
    .eq('organization_id', orgId)
    .is('deleted_at', null)
    .select('id')

  if (undoErr) {
    return NextResponse.json(
      { error: `Failed to undo import: ${undoErr.message}` },
      { status: 500 },
    )
  }

  // The user-facing undo count is what THIS sweep accomplished — the
  // second sweep below is a race-cleanup detail, not something the
  // clinic needs to see in their "undone X contacts" confirmation.
  const undone_count = undone?.length ?? 0

  // ── Race safeguard for mid-processing undos ──────────────
  // If the import was still processing when the user clicked undo,
  // there's a small window between our status read and the soft-delete
  // UPDATE where an in-flight chunk could have committed new rows —
  // those wouldn't have been caught by the first sweep.
  //
  // We close the window in two moves:
  //   1. Transition status 'processing' → 'undone'. The main import
  //      route rejects any chunk POST against an import whose status
  //      is not 'processing', so no further chunks can land.
  //   2. Re-run the soft-delete as a cleanup sweep. Idempotent against
  //      the first sweep (it only touches deleted_at IS NULL rows, and
  //      the first sweep already set them all), so its only effect is
  //      to catch rows that committed in the race window.
  //
  // Doing the status flip BEFORE the second sweep matters: once status
  // is 'undone', new chunks are rejected, so the second sweep cleans up
  // the finite set of rows that raced and the window is closed.
  if (imp.status === 'processing') {
    await supabaseAdmin
      .from('contact_imports')
      .update({ status: 'undone' })
      .eq('id', imp.id)

    await supabaseAdmin
      .from('contacts')
      .update({ deleted_at: new Date().toISOString() })
      .eq('import_id', imp.id)
      .eq('organization_id', orgId)
      .is('deleted_at', null)
  }

  await supabaseAdmin.from('activity_log').insert({
    organization_id: orgId,
    user_id:         user.id,
    action:          'contacts_import_undone',
    metadata: {
      import_id:       imp.id,
      undone_count,
      prior_status:    imp.status,
    },
  })

  const response: ImportUndoResponse = {
    import_id:    imp.id,
    undone_count,
  }

  return NextResponse.json(response)
}
