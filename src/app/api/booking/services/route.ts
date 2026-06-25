import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

const ADMIN_ROLES = new Set(['owner', 'admin'])

// Hex color (#RGB or #RRGGBB) — same shape we accept elsewhere.
const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

const createServiceSchema = z.object({
  name:                z.string().trim().min(1).max(120),
  description:         z.string().trim().max(1000).nullable().optional(),
  duration_min:        z.number().int().min(5).max(480),
  price_cents:         z.number().int().min(0).nullable().optional(),
  lead_time_hours:     z.number().int().min(0).max(720).optional(),
  booking_horizon_days: z.number().int().min(1).max(365).optional(),
  is_bookable_online:  z.boolean().optional(),
  color:               z.string().regex(HEX_RE, 'Invalid hex color').nullable().optional(),
  position:            z.number().int().min(0).max(9999).optional(),
  provider_ids:        z.array(z.string().uuid()).optional().default([]),
})

// ─── GET /api/booking/services ────────────────────────────────
export async function GET(_req: NextRequest) {
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

  const { data: services, error } = await supabase
    .from('services')
    .select(`
      id,
      organization_id,
      name,
      description,
      duration_min,
      price_cents,
      lead_time_hours,
      booking_horizon_days,
      is_active,
      is_bookable_online,
      color,
      position,
      created_at,
      updated_at
    `)
    .eq('organization_id', orgId)
    .order('position', { ascending: true })
    .order('name', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const ids = (services ?? []).map((s) => s.id)
  let assignments: Array<{ service_id: string; provider_id: string }> = []
  if (ids.length > 0) {
    const { data: rows } = await supabase
      .from('service_providers')
      .select('service_id, provider_id')
      .eq('organization_id', orgId)
      .in('service_id', ids)
    assignments = rows ?? []
  }

  const byService = new Map<string, string[]>()
  for (const row of assignments) {
    const list = byService.get(row.service_id) ?? []
    list.push(row.provider_id)
    byService.set(row.service_id, list)
  }

  const enriched = (services ?? []).map((s) => ({
    ...s,
    provider_ids: byService.get(s.id) ?? [],
  }))

  return NextResponse.json(enriched)
}

// ─── POST /api/booking/services ───────────────────────────────
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
    return NextResponse.json({ error: 'Only owners or admins can manage services.' }, { status: 403 })
  }

  let rawBody: unknown
  try { rawBody = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = createServiceSchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const { provider_ids, ...fields } = parsed.data
  const orgId = profile.organization_id

  const { data: service, error: insertError } = await supabase
    .from('services')
    .insert({
      organization_id:      orgId,
      name:                 fields.name,
      description:          fields.description ?? null,
      duration_min:         fields.duration_min,
      price_cents:          fields.price_cents ?? null,
      lead_time_hours:      fields.lead_time_hours ?? 24,
      booking_horizon_days: fields.booking_horizon_days ?? 60,
      is_bookable_online:   fields.is_bookable_online ?? true,
      color:                fields.color ?? null,
      position:             fields.position ?? 0,
    })
    .select('id')
    .single()

  if (insertError || !service) {
    return NextResponse.json({ error: insertError?.message ?? 'Failed to create service' }, { status: 500 })
  }

  if (provider_ids.length > 0) {
    const { data: validProviders } = await supabase
      .from('providers')
      .select('id')
      .eq('organization_id', orgId)
      .in('id', provider_ids)

    const validIds = new Set((validProviders ?? []).map((p) => p.id))
    if (validIds.size !== provider_ids.length) {
      // Cascade rollback: delete the service we just created.
      await supabase.from('services').delete().eq('id', service.id).eq('organization_id', orgId)
      return NextResponse.json({
        error: 'invalid_provider_ids',
        message: 'One or more provider ids do not belong to your organization.',
      }, { status: 400 })
    }
    const rows = provider_ids
      .map((pid) => ({
        provider_id:     pid,
        service_id:      service.id,
        organization_id: orgId,
      }))

    if (rows.length > 0) {
      const { error: linkErr } = await supabase.from('service_providers').insert(rows)
      if (linkErr) {
        return NextResponse.json({ error: linkErr.message }, { status: 500 })
      }
    }
  }

  return NextResponse.json({ id: service.id }, { status: 201 })
}
