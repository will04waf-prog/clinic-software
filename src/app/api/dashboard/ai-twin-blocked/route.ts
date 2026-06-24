import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { cached } from '@/lib/route-cache'

// 60s in-memory TTL. The Blocked list is a review tool, not a real-time
// alert — staff opening the W3 review page within a minute of a fresh
// guardrail failure can wait for the next refresh.
const BLOCKED_CACHE_TTL_MS = 60_000

/**
 * GET /api/dashboard/ai-twin-blocked
 *
 * Returns the most recent guardrail_failed drafts for the caller's org.
 * Capped at 50 rows, last 30 days. Powers the optional "Blocked" tab
 * on the W3 review page.
 *
 * Org-isolated via RLS + explicit organization_id filter. 60s route-
 * cache per org.
 */
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
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const rows = await cached(`ai-twin-blocked:${orgId}`, BLOCKED_CACHE_TTL_MS, async () => {
    const { data, error } = await supabase
      .from('ai_drafts')
      .select('id, draft_body, guardrail_violation, generated_at, context_snapshot')
      .eq('organization_id', orgId)
      .eq('state', 'guardrail_failed')
      .gte('generated_at', thirtyDaysAgo)
      .order('generated_at', { ascending: false })
      .limit(50)
    if (error) {
      console.error('[ai-twin-blocked] query error:', error.message)
      return []
    }
    return data ?? []
  })

  return NextResponse.json({ rows })
}
