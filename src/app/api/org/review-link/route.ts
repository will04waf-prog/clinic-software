/**
 * PATCH /api/org/review-link — the review-request feature's on-switch.
 *
 * Owner-only. Stores the org's Google Place ID (organizations.
 * google_place_id — the same column the med-spa call agent uses for
 * directions, so both features share one source of truth). Accepts a
 * bare Place ID or any Google URL carrying placeid=; empty input clears
 * it, which turns the review flow off.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireRole, isDenied, OWNER_ONLY } from '@/lib/auth/roles'
import { parsePlaceIdInput, reviewLinkFromPlaceId } from '@/lib/loop/review-request'

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await requireRole(supabase, user.id, OWNER_ONLY)
  if (isDenied(gate)) return gate.response

  const body = await req.json().catch(() => null) as { input?: unknown } | null
  if (!body || typeof body.input !== 'string') {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }

  const raw = body.input.trim()
  const placeId = raw === '' ? null : parsePlaceIdInput(raw)
  if (raw !== '' && !placeId) {
    return NextResponse.json({ error: 'unparseable' }, { status: 422 })
  }

  const { error } = await supabase
    .from('organizations')
    .update({ google_place_id: placeId })
    .eq('id', gate.orgId)
  if (error) {
    console.error('[org/review-link] update failed:', error.message)
    return NextResponse.json({ error: 'save_failed' }, { status: 500 })
  }

  return NextResponse.json({
    placeId,
    link: placeId ? reviewLinkFromPlaceId(placeId) : null,
  })
}
