import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

const ADMIN_ROLES = new Set(['owner', 'admin', 'staff'])

const createProviderSchema = z.object({
  display_name:      z.string().trim().min(1).max(120),
  role_label:        z.string().trim().max(80).nullable().optional(),
  // Permissive — any string up to 500 chars, including empty. UI
  // gracefully handles broken/empty URLs via a fallback initial.
  // Stricter URL validation can return when Supabase storage upload
  // ships in W2 and we know the field is always a real URL.
  photo_url:         z.string().trim().max(500).nullable().optional(),
  profile_id:        z.string().uuid().nullable().optional(),
  buffer_before_min: z.number().int().min(0).max(240).optional(),
  buffer_after_min:  z.number().int().min(0).max(240).optional(),
  service_ids:       z.array(z.string().uuid()).optional().default([]),
})

// ─── GET /api/booking/providers ───────────────────────────────
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

  const { data: providers, error } = await supabase
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
    .eq('organization_id', orgId)
    .order('display_name', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const ids = (providers ?? []).map((p) => p.id)
  let assignments: Array<{ provider_id: string; service_id: string }> = []
  if (ids.length > 0) {
    const { data: rows } = await supabase
      .from('service_providers')
      .select('provider_id, service_id')
      .eq('organization_id', orgId)
      .in('provider_id', ids)
    assignments = rows ?? []
  }

  const byProvider = new Map<string, string[]>()
  for (const row of assignments) {
    const list = byProvider.get(row.provider_id) ?? []
    list.push(row.service_id)
    byProvider.set(row.provider_id, list)
  }

  const enriched = (providers ?? []).map((p) => ({
    ...p,
    service_ids: byProvider.get(p.id) ?? [],
  }))

  // Wrap the array under `providers` to match the UI's expected
  // response shape — all the booking-settings cards read pJson.providers
  // and the staff/voice-examples conventions return the same { key: [] }
  // shape elsewhere in the API.
  return NextResponse.json({ providers: enriched })
}

// ─── POST /api/booking/providers ──────────────────────────────
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
    return NextResponse.json({ error: 'Only owners or admins can manage providers.' }, { status: 403 })
  }

  let rawBody: unknown
  try { rawBody = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = createProviderSchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const { service_ids, ...fields } = parsed.data
  const orgId = profile.organization_id

  // If profile_id provided, ensure it belongs to this org.
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

  const { data: provider, error: insertError } = await supabase
    .from('providers')
    .insert({
      organization_id:   orgId,
      display_name:      fields.display_name,
      role_label:        fields.role_label ?? null,
      photo_url:         fields.photo_url ?? null,
      profile_id:        fields.profile_id ?? null,
      buffer_before_min: fields.buffer_before_min ?? 0,
      buffer_after_min:  fields.buffer_after_min ?? 15,
    })
    .select('id')
    .single()

  if (insertError || !provider) {
    return NextResponse.json({ error: insertError?.message ?? 'Failed to create provider' }, { status: 500 })
  }

  // Validate + assign services. Reject cross-org IDs with a 400
  // rather than silently dropping them. Silent drop = caller thinks
  // the save worked while the link silently went missing.
  if (service_ids.length > 0) {
    const { data: validServices } = await supabase
      .from('services')
      .select('id')
      .eq('organization_id', orgId)
      .in('id', service_ids)

    const validIds = new Set((validServices ?? []).map((s) => s.id))
    if (validIds.size !== service_ids.length) {
      // Cascade rollback: delete the provider we just created so the
      // owner can resubmit with valid IDs without orphaning a row.
      await supabase.from('providers').delete().eq('id', provider.id).eq('organization_id', orgId)
      return NextResponse.json({
        error: 'invalid_service_ids',
        message: 'One or more service ids do not belong to your organization.',
      }, { status: 400 })
    }
    const rows = service_ids
      .map((id) => ({
        provider_id:     provider.id,
        service_id:      id,
        organization_id: orgId,
      }))

    if (rows.length > 0) {
      const { error: linkErr } = await supabase.from('service_providers').insert(rows)
      if (linkErr) {
        return NextResponse.json({ error: linkErr.message }, { status: 500 })
      }
    }
  }

  return NextResponse.json({ id: provider.id }, { status: 201 })
}
