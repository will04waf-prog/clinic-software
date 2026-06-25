import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

const ADMIN_ROLES = new Set(['owner', 'admin', 'staff'])
const HHMM_RE = /^([01][0-9]|2[0-3]):[0-5][0-9]$/

const ruleSchema = z.object({
  weekday:    z.number().int().min(0).max(6),
  startTime:  z.string().regex(HHMM_RE, 'startTime must be HH:MM'),
  endTime:    z.string().regex(HHMM_RE, 'endTime must be HH:MM'),
}).refine((r) => r.startTime < r.endTime, {
  message: 'startTime must be earlier than endTime (split cross-midnight ranges into two rules)',
})

const putSchema = z.object({
  providerId: z.string().uuid(),
  rules:      z.array(ruleSchema).max(200),
})

// ─── GET /api/booking/availability-rules ──────────────────────
// Optional ?providerId=uuid filter.
export async function GET(req: NextRequest) {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single()

  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  const orgId = profile.organization_id
  const { searchParams } = new URL(req.url)
  const providerId = searchParams.get('providerId')

  let query = supabase
    .from('availability_rules')
    .select('id, organization_id, provider_id, weekday, start_time, end_time, created_at')
    .eq('organization_id', orgId)
    .order('weekday', { ascending: true })
    .order('start_time', { ascending: true })

  if (providerId) query = query.eq('provider_id', providerId)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data ?? [])
}

// ─── PUT /api/booking/availability-rules ──────────────────────
// Replaces the entire rule set for one provider.
export async function PUT(req: NextRequest) {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id, role')
    .eq('id', user.id)
    .single()

  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  if (!ADMIN_ROLES.has((profile.role as string) ?? '')) {
    return NextResponse.json({ error: 'Only owners or admins can change availability.' }, { status: 403 })
  }

  let rawBody: unknown
  try { rawBody = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = putSchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const { providerId, rules } = parsed.data
  const orgId = profile.organization_id

  // Confirm provider belongs to this org.
  const { data: provider } = await supabase
    .from('providers')
    .select('id')
    .eq('id', providerId)
    .eq('organization_id', orgId)
    .maybeSingle()

  if (!provider) {
    return NextResponse.json({ error: 'Provider not found' }, { status: 404 })
  }

  // Replace ruleset for this provider. Postgres has no nested
  // transactions from PostgREST, so we snapshot first → delete →
  // insert → restore if insert fails. The window where the provider
  // has zero rules is small, but the snapshot guarantees we never
  // leave the provider stranded with zero rows after a failed
  // insert (data-loss scenario the reviewer flagged).
  const { data: snapshotData, error: snapErr } = await supabase
    .from('availability_rules')
    .select('weekday, start_time, end_time')
    .eq('organization_id', orgId)
    .eq('provider_id', providerId)

  if (snapErr) return NextResponse.json({ error: snapErr.message }, { status: 500 })
  const snapshot = (snapshotData ?? []) as Array<{ weekday: number; start_time: string; end_time: string }>

  const { error: delErr } = await supabase
    .from('availability_rules')
    .delete()
    .eq('organization_id', orgId)
    .eq('provider_id', providerId)

  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })

  if (rules.length > 0) {
    const rows = rules.map((r) => ({
      organization_id: orgId,
      provider_id:     providerId,
      weekday:         r.weekday,
      start_time:      r.startTime,
      end_time:        r.endTime,
    }))
    const { error: insErr } = await supabase
      .from('availability_rules')
      .insert(rows)

    if (insErr) {
      // Restore snapshot. If THIS fails, the provider has zero rules
      // and the response surfaces both errors so ops can see what
      // happened — better than silently lying about a successful save.
      const restorePayload = snapshot.map((r) => ({
        organization_id: orgId,
        provider_id:     providerId,
        weekday:         r.weekday,
        start_time:      r.start_time,
        end_time:        r.end_time,
      }))
      if (restorePayload.length > 0) {
        const { error: restoreErr } = await supabase
          .from('availability_rules')
          .insert(restorePayload)
        if (restoreErr) {
          console.error('[availability-rules] CATASTROPHIC: insert failed AND snapshot restore failed', {
            providerId, insertErr: insErr.message, restoreErr: restoreErr.message,
          })
          return NextResponse.json({
            error: 'availability_rules_lost',
            message: 'Update failed and snapshot restore also failed — contact support.',
            insert_error: insErr.message,
            restore_error: restoreErr.message,
          }, { status: 500 })
        }
      }
      return NextResponse.json({ error: insErr.message }, { status: 500 })
    }
  }

  return NextResponse.json({ ok: true })
}
