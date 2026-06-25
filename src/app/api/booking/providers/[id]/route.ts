import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

const ADMIN_ROLES = new Set(['owner', 'admin', 'staff'])

const patchProviderSchema = z.object({
  display_name:      z.string().trim().min(1).max(120).optional(),
  role_label:        z.string().trim().max(80).nullable().optional(),
  photo_url:         z.string().trim().max(500).nullable().optional(),
  profile_id:        z.string().uuid().nullable().optional(),
  is_active:         z.boolean().optional(),
  buffer_before_min: z.number().int().min(0).max(240).optional(),
  buffer_after_min:  z.number().int().min(0).max(240).optional(),
  service_ids:       z.array(z.string().uuid()).optional(),
}).strict()

async function resolveOrg(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  const { data } = await supabase
    .from('profiles')
    .select('organization_id, role')
    .eq('id', userId)
    .single()
  return data
}

// ─── GET /api/booking/providers/[id] ──────────────────────────
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

  const { data: provider, error } = await supabase
    .from('providers')
    .select(`
      id,
      organization_id,
      profile_id,
      display_name,
      role_label,
      photo_url,
      is_active,
      buffer_before_min,
      buffer_after_min,
      created_at,
      updated_at
    `)
    .eq('id', id)
    .eq('organization_id', orgId)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!provider) return NextResponse.json({ error: 'Provider not found' }, { status: 404 })

  const { data: links } = await supabase
    .from('service_providers')
    .select('service_id')
    .eq('organization_id', orgId)
    .eq('provider_id', id)

  return NextResponse.json({
    ...provider,
    service_ids: (links ?? []).map((l) => l.service_id),
  })
}

// ─── PATCH /api/booking/providers/[id] ────────────────────────
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
    return NextResponse.json({ error: 'Only owners or admins can manage providers.' }, { status: 403 })
  }

  const orgId = profile.organization_id

  const { data: existing } = await supabase
    .from('providers')
    .select('id')
    .eq('id', id)
    .eq('organization_id', orgId)
    .maybeSingle()

  if (!existing) return NextResponse.json({ error: 'Provider not found' }, { status: 404 })

  let rawBody: unknown
  try { rawBody = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = patchProviderSchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const { service_ids, ...fields } = parsed.data

  if (fields.profile_id) {
    const { data: staff } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', fields.profile_id)
      .eq('organization_id', orgId)
      .maybeSingle()
    if (!staff) {
      return NextResponse.json({ error: 'Linked staff profile not found in your organization.' }, { status: 400 })
    }
  }

  if (Object.keys(fields).length > 0) {
    const { error: updateError } = await supabase
      .from('providers')
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('organization_id', orgId)
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  if (service_ids) {
    // Validate input BEFORE deleting — cross-org IDs are a 400, not
    // a silent drop. (The earlier silent-filter pattern would tell
    // the user the save succeeded while quietly omitting their input.)
    let intendedRows: Array<{ provider_id: string; service_id: string; organization_id: string }> = []
    if (service_ids.length > 0) {
      const { data: validServices } = await supabase
        .from('services')
        .select('id')
        .eq('organization_id', orgId)
        .in('id', service_ids)
      const validIds = new Set((validServices ?? []).map((s) => s.id))
      if (validIds.size !== service_ids.length) {
        return NextResponse.json({
          error: 'invalid_service_ids',
          message: 'One or more service ids do not belong to your organization.',
        }, { status: 400 })
      }
      intendedRows = service_ids.map((sid) => ({
        provider_id:     id,
        service_id:      sid,
        organization_id: orgId,
      }))
    }

    // Snapshot → delete → insert → restore-on-failure (matches the
    // availability-rules pattern). PostgREST gives us no transaction,
    // so this is the next-best defense against losing all service
    // links if the insert fails after the delete succeeds.
    const { data: snapshot } = await supabase
      .from('service_providers')
      .select('service_id')
      .eq('organization_id', orgId)
      .eq('provider_id', id)

    const { error: delErr } = await supabase
      .from('service_providers')
      .delete()
      .eq('organization_id', orgId)
      .eq('provider_id', id)
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })

    if (intendedRows.length > 0) {
      const { error: linkErr } = await supabase.from('service_providers').insert(intendedRows)
      if (linkErr) {
        const restoreRows = (snapshot ?? []).map((r) => ({
          provider_id:     id,
          service_id:      r.service_id as string,
          organization_id: orgId,
        }))
        if (restoreRows.length > 0) {
          const { error: restoreErr } = await supabase.from('service_providers').insert(restoreRows)
          if (restoreErr) {
            console.error('[providers/PATCH] insert failed AND snapshot restore failed', {
              providerId: id, insertErr: linkErr.message, restoreErr: restoreErr.message,
            })
          }
        }
        return NextResponse.json({ error: linkErr.message }, { status: 500 })
      }
    }
  }

  return NextResponse.json({ ok: true })
}

// ─── DELETE /api/booking/providers/[id] ───────────────────────
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
    return NextResponse.json({ error: 'Only owners or admins can manage providers.' }, { status: 403 })
  }

  const orgId = profile.organization_id

  // Soft delete: flip is_active=false. Preserves history on consultations that reference this provider.
  const { error } = await supabase
    .from('providers')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('organization_id', orgId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
