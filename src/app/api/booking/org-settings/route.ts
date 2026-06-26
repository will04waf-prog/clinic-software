import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { requireRole, isDenied, OWNER_ADMIN } from '@/lib/auth/roles'

/**
 * GET  /api/booking/org-settings  — current booking_enabled flag + slug
 * PATCH /api/booking/org-settings — update booking_enabled
 *
 * Used by the BookingMasterToggleCard on /settings/booking. The
 * public-facing kill switch — flipping booking_enabled to false
 * immediately makes /book/[slug] render "paused" and refuses every
 * hold/confirm attempt with 403.
 */

const PatchSchema = z.object({
  booking_enabled: z.boolean(),
})

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

  const { data: org, error } = await supabase
    .from('organizations')
    .select('booking_enabled, slug')
    .eq('id', profile.organization_id)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({
    booking_enabled: org?.booking_enabled === true,
    slug:            (org?.slug as string | null) ?? null,
  })
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await requireRole(supabase, user.id, OWNER_ADMIN)
  if (isDenied(gate)) return gate.response

  let rawBody: unknown
  try { rawBody = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const parsed = PatchSchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const { error } = await supabase
    .from('organizations')
    .update({ booking_enabled: parsed.data.booking_enabled })
    .eq('id', gate.orgId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, booking_enabled: parsed.data.booking_enabled })
}
