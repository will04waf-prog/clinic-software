import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

const ADMIN_ROLES = new Set(['owner', 'admin'])
const HHMM_RE = /^([01][0-9]|2[0-3]):[0-5][0-9]$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const createOverrideSchema = z.object({
  providerId: z.string().uuid().nullable().optional(),
  kind:       z.enum(['closed', 'custom']),
  date:       z.string().regex(DATE_RE, 'date must be YYYY-MM-DD'),
  startTime:  z.string().regex(HHMM_RE, 'startTime must be HH:MM').nullable().optional(),
  endTime:    z.string().regex(HHMM_RE, 'endTime must be HH:MM').nullable().optional(),
  reason:     z.string().trim().max(200).nullable().optional(),
}).refine(
  (o) => o.kind !== 'custom' || (typeof o.startTime === 'string' && typeof o.endTime === 'string'),
  { message: 'custom overrides require startTime and endTime' },
).refine(
  (o) => o.kind !== 'custom' || !o.startTime || !o.endTime || o.startTime < o.endTime,
  { message: 'startTime must be earlier than endTime' },
)

// ─── GET /api/booking/availability-overrides ──────────────────
// Optional ?from=YYYY-MM-DD&to=YYYY-MM-DD window.
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
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  let query = supabase
    .from('availability_overrides')
    .select('id, organization_id, provider_id, kind, date, start_time, end_time, reason, created_at')
    .eq('organization_id', orgId)
    .order('date', { ascending: true })

  if (from && DATE_RE.test(from)) query = query.gte('date', from)
  if (to && DATE_RE.test(to))   query = query.lte('date', to)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data ?? [])
}

// ─── POST /api/booking/availability-overrides ─────────────────
export async function POST(req: NextRequest) {
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

  const parsed = createOverrideSchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const { providerId, kind, date, startTime, endTime, reason } = parsed.data
  const orgId = profile.organization_id

  if (providerId) {
    const { data: provider } = await supabase
      .from('providers')
      .select('id')
      .eq('id', providerId)
      .eq('organization_id', orgId)
      .maybeSingle()
    if (!provider) {
      return NextResponse.json({ error: 'Provider not found' }, { status: 404 })
    }
  }

  const { data: inserted, error } = await supabase
    .from('availability_overrides')
    .insert({
      organization_id: orgId,
      provider_id:     providerId ?? null,
      kind,
      date,
      start_time:      kind === 'custom' ? startTime ?? null : null,
      end_time:        kind === 'custom' ? endTime ?? null : null,
      reason:          reason ?? null,
    })
    .select('id')
    .single()

  if (error || !inserted) {
    return NextResponse.json({ error: error?.message ?? 'Failed to create override' }, { status: 500 })
  }

  return NextResponse.json({ id: inserted.id }, { status: 201 })
}

// ─── DELETE /api/booking/availability-overrides?id=uuid ───────
export async function DELETE(req: NextRequest) {
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

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id query param is required' }, { status: 400 })

  const orgId = profile.organization_id

  const { data: existing } = await supabase
    .from('availability_overrides')
    .select('id')
    .eq('id', id)
    .eq('organization_id', orgId)
    .maybeSingle()

  if (!existing) return NextResponse.json({ error: 'Override not found' }, { status: 404 })

  const { error } = await supabase
    .from('availability_overrides')
    .delete()
    .eq('id', id)
    .eq('organization_id', orgId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
