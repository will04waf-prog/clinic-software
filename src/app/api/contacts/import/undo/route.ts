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

  // Only completed imports are undoable. A still-processing import may
  // still be receiving chunks — undoing mid-flight would race with the
  // remaining inserts. A failed import should be cleaned up manually
  // (or by a future targeted tool) rather than via this route.
  if (imp.status !== 'completed') {
    return NextResponse.json(
      { error: `Cannot undo: import is ${imp.status}, not completed.` },
      { status: 409 },
    )
  }

  // ── 24h window check, measured from completion ────────────
  // Window starts when the last chunk finished, not when the first chunk
  // arrived — matches the clinic's mental model ("undo within 24h of
  // seeing the success screen"). completed_at is guaranteed non-null
  // here because status === 'completed' implies the finalize path ran;
  // the started_at fallback is defensive only.
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

  const undone_count = undone?.length ?? 0

  // Activity log
  await supabaseAdmin.from('activity_log').insert({
    organization_id: orgId,
    user_id:         user.id,
    action:          'contacts_import_undone',
    metadata: {
      import_id:    imp.id,
      undone_count,
    },
  })

  const response: ImportUndoResponse = {
    import_id:    imp.id,
    undone_count,
  }

  return NextResponse.json(response)
}
