import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

// Unauthenticated liveness + DB-reachability probe for an uptime monitor.
// Returns 200 {ok:true} when the app can reach Postgres, 503 otherwise.
// Deliberately leaks nothing — no row data, no version, no env. A HEAD or
// GET is enough for Pingdom/BetterUptime/UptimeRobot to alert on outage.
export const dynamic = 'force-dynamic'

export async function GET() {
  const startedAt = Date.now()
  try {
    // Cheapest possible reachability check: HEAD-count a tiny table.
    const { error } = await supabaseAdmin
      .from('organizations')
      .select('id', { count: 'exact', head: true })
      .limit(1)
    if (error) throw error
    return NextResponse.json(
      { ok: true, db: 'up', ms: Date.now() - startedAt },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch {
    return NextResponse.json(
      { ok: false, db: 'down' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
