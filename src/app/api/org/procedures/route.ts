import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireRole, isDenied, OWNER_ADMIN } from '@/lib/auth/roles'
import { z } from 'zod'

const patchSchema = z.object({
  procedures: z.array(z.string()).min(0),
})

// ─── PATCH /api/org/procedures ────────────────────────────────
export async function PATCH(req: NextRequest) {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await requireRole(supabase, user.id, OWNER_ADMIN)
  if (isDenied(gate)) return gate.response

  // Guard the parse (audit L6) — a malformed/empty body should be a clean
  // 400, not an unhandled 500. Matches the pattern in the sibling org routes.
  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const { procedures } = parsed.data

  const { error } = await supabase
    .from('organizations')
    .update({ procedures })
    .eq('id', gate.orgId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
