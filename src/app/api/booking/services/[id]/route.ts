import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

const ADMIN_ROLES = new Set(['owner', 'admin'])

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

const patchServiceSchema = z.object({
  name:                 z.string().trim().min(1).max(120).optional(),
  description:          z.string().trim().max(1000).nullable().optional(),
  duration_min:         z.number().int().min(5).max(480).optional(),
  price_cents:          z.number().int().min(0).nullable().optional(),
  lead_time_hours:      z.number().int().min(0).max(720).optional(),
  booking_horizon_days: z.number().int().min(1).max(365).optional(),
  is_active:            z.boolean().optional(),
  is_bookable_online:   z.boolean().optional(),
  color:                z.string().regex(HEX_RE, 'Invalid hex color').nullable().optional(),
  position:             z.number().int().min(0).max(9999).optional(),
  provider_ids:         z.array(z.string().uuid()).optional(),
}).strict()

async function resolveOrg(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  const { data } = await supabase
    .from('profiles')
    .select('organization_id, role')
    .eq('id', userId)
    .single()
  return data
}

// ─── GET /api/booking/services/[id] ───────────────────────────
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const profile = await resolveOrg(supabase, user.id)
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  const orgId = profile.organization_id

  const { data: service, error } = await supabase
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
    .eq('id', id)
    .eq('organization_id', orgId)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!service) return NextResponse.json({ error: 'Service not found' }, { status: 404 })

  const { data: links } = await supabase
    .from('service_providers')
    .select('provider_id')
    .eq('organization_id', orgId)
    .eq('service_id', id)

  return NextResponse.json({
    ...service,
    provider_ids: (links ?? []).map((l) => l.provider_id),
  })
}

// ─── PATCH /api/booking/services/[id] ─────────────────────────
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const profile = await resolveOrg(supabase, user.id)
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  if (!ADMIN_ROLES.has((profile.role as string) ?? '')) {
    return NextResponse.json({ error: 'Only owners or admins can manage services.' }, { status: 403 })
  }

  const orgId = profile.organization_id

  const { data: existing } = await supabase
    .from('services')
    .select('id')
    .eq('id', id)
    .eq('organization_id', orgId)
    .maybeSingle()

  if (!existing) return NextResponse.json({ error: 'Service not found' }, { status: 404 })

  let rawBody: unknown
  try { rawBody = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = patchServiceSchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const { provider_ids, ...fields } = parsed.data

  if (Object.keys(fields).length > 0) {
    const { error: updateError } = await supabase
      .from('services')
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('organization_id', orgId)
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  if (provider_ids) {
    // Validate cross-org input BEFORE deleting. Reject 400 instead
    // of silently filtering — the previous "drop and forget" pattern
    // would tell the user the save succeeded while losing input.
    let intendedRows: Array<{ provider_id: string; service_id: string; organization_id: string }> = []
    if (provider_ids.length > 0) {
      const { data: validProviders } = await supabase
        .from('providers')
        .select('id')
        .eq('organization_id', orgId)
        .in('id', provider_ids)
      const validIds = new Set((validProviders ?? []).map((p) => p.id))
      if (validIds.size !== provider_ids.length) {
        return NextResponse.json({
          error: 'invalid_provider_ids',
          message: 'One or more provider ids do not belong to your organization.',
        }, { status: 400 })
      }
      intendedRows = provider_ids.map((pid) => ({
        provider_id:     pid,
        service_id:      id,
        organization_id: orgId,
      }))
    }

    // Snapshot → delete → insert → restore-on-failure.
    const { data: snapshot } = await supabase
      .from('service_providers')
      .select('provider_id')
      .eq('organization_id', orgId)
      .eq('service_id', id)

    const { error: delErr } = await supabase
      .from('service_providers')
      .delete()
      .eq('organization_id', orgId)
      .eq('service_id', id)
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })

    if (intendedRows.length > 0) {
      const { error: linkErr } = await supabase.from('service_providers').insert(intendedRows)
      if (linkErr) {
        const restoreRows = (snapshot ?? []).map((r) => ({
          provider_id:     r.provider_id as string,
          service_id:      id,
          organization_id: orgId,
        }))
        if (restoreRows.length > 0) {
          const { error: restoreErr } = await supabase.from('service_providers').insert(restoreRows)
          if (restoreErr) {
            console.error('[services/PATCH] insert failed AND snapshot restore failed', {
              serviceId: id, insertErr: linkErr.message, restoreErr: restoreErr.message,
            })
          }
        }
        return NextResponse.json({ error: linkErr.message }, { status: 500 })
      }
    }
  }

  return NextResponse.json({ ok: true })
}

// ─── DELETE /api/booking/services/[id] ────────────────────────
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const profile = await resolveOrg(supabase, user.id)
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  if (!ADMIN_ROLES.has((profile.role as string) ?? '')) {
    return NextResponse.json({ error: 'Only owners or admins can manage services.' }, { status: 403 })
  }

  const orgId = profile.organization_id

  const { error } = await supabase
    .from('services')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('organization_id', orgId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
