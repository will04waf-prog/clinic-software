import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

// HH:MM with 24-hour clock. Accepts either null or a valid time-of-day
// string. We store these in a Postgres `time` column, which round-trips
// as "HH:MM:SS" — both formats are accepted on input and we normalize.
const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

const AiTwinSettingsSchema = z.object({
  ai_twin_enabled: z.boolean(),
  ai_twin_quiet_hours_start: z.string().regex(HHMM_RE).nullable().optional(),
  ai_twin_quiet_hours_end:   z.string().regex(HHMM_RE).nullable().optional(),
})

/**
 * PATCH /api/org/ai-twin-settings
 *
 * Updates the caller-org's AI Twin master switch + optional quiet-hours
 * window. Both quiet-hours columns must be set together — a half-
 * configured window is enforced at the DB level too, but we 400 early
 * here for a nicer error message.
 *
 * Returns the new state in the response body so the client can re-
 * hydrate without re-fetching.
 */
export async function PATCH(request: Request) {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single()
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  const body = await request.json().catch(() => null)
  const parsed = AiTwinSettingsSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const start = parsed.data.ai_twin_quiet_hours_start ?? null
  const end   = parsed.data.ai_twin_quiet_hours_end   ?? null
  const oneSet = (start === null) !== (end === null)
  if (oneSet) {
    return NextResponse.json(
      { error: 'Quiet hours start and end must both be set, or both cleared.' },
      { status: 400 },
    )
  }
  if (start !== null && end !== null && start === end) {
    return NextResponse.json(
      { error: 'Quiet hours start and end cannot be identical.' },
      { status: 400 },
    )
  }

  const update = {
    ai_twin_enabled: parsed.data.ai_twin_enabled,
    ai_twin_quiet_hours_start: start,
    ai_twin_quiet_hours_end:   end,
  }

  const { error } = await supabase
    .from('organizations')
    .update(update)
    .eq('id', profile.organization_id)

  if (error) {
    console.error('[ai-twin-settings] update error:', error)
    return NextResponse.json({ error: 'Failed to save settings.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, settings: update })
}
