/**
 * Phase 4 W9 — read-only seat usage indicator.
 *
 * GET /api/org/team/seats → { used, cap, tier, active, pending }
 *
 * Drives the "3 of 5 seats used" hint on the Team settings page
 * and lets the Invite button render a locked-state preview before
 * the user clicks. Owner-only because seat numbers + tier reveal
 * billing posture.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireRole, isDenied, OWNER_ONLY } from '@/lib/auth/roles'
import { fetchOrgTier } from '@/lib/billing/org-tier'
import { countActiveSeats } from '@/lib/billing/seats'

export async function GET() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await requireRole(supabase, user.id, OWNER_ONLY)
  if (isDenied(gate)) return gate.response

  const [eff, seats] = await Promise.all([
    fetchOrgTier(supabase, gate.orgId),
    countActiveSeats(supabase, gate.orgId),
  ])
  if (!eff) {
    return NextResponse.json({
      tier:    'starter',
      cap:     0,
      used:    seats.total,
      active:  seats.active,
      pending: seats.pending,
    })
  }

  // Stringify Infinity for the wire — JSON serializes Infinity as
  // null, which the UI handles ambiguously. Send "unlimited" as a
  // sentinel that's clearer in copy.
  const capWire: number | 'unlimited' =
    eff.limits.seatCap === Number.POSITIVE_INFINITY ? 'unlimited' : eff.limits.seatCap

  return NextResponse.json({
    tier:    eff.tier,
    cap:     capWire,
    used:    seats.total,
    active:  seats.active,
    pending: seats.pending,
  })
}
