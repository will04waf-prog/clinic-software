/**
 * Stripe Connect Express onboarding — owner-only.
 *
 *   POST  → JSON { url } for the settings-card button to redirect to.
 *   GET   → 302 to a fresh link; used as the account-link `refresh_url`
 *           so an expired/abandoned onboarding just restarts cleanly.
 *
 * Ensures the org has an Express account (creating one on first call),
 * then mints an onboarding link. All Stripe work is in @/lib/stripe/connect.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireRole, isDenied, OWNER_ONLY } from '@/lib/auth/roles'
import { ensureConnectAccount, createOnboardingLink } from '@/lib/stripe/connect'

async function startOnboarding(req: NextRequest): Promise<{ url: string } | { error: string; status: number } | { denied: NextResponse }> {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: 'Unauthorized', status: 401 }

  const gate = await requireRole(supabase, user.id, OWNER_ONLY)
  if (isDenied(gate)) return { denied: gate.response }
  const orgId = gate.orgId

  const { data: profile } = await supabase
    .from('profiles')
    .select('email, full_name, organizations(name)')
    .eq('id', user.id)
    .single()
  const org = (profile?.organizations ?? null) as { name?: string } | null

  const accountId = await ensureConnectAccount(orgId, {
    name: org?.name ?? profile?.full_name ?? null,
    email: profile?.email ?? null,
  })
  const url = await createOnboardingLink(accountId, new URL(req.url).origin)
  return { url }
}

export async function POST(req: NextRequest) {
  try {
    const result = await startOnboarding(req)
    if ('denied' in result) return result.denied
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ url: result.url })
  } catch (err: any) {
    // Raw Stripe messages are for THIS log line only — owners get a
    // stable code the card maps to friendly localized copy. (Prod
    // defect 2026-07-13: the live platform-profile error rendered raw
    // English in a Spanish owner's Settings.)
    console.error('[connect/onboard] POST error:', err?.message)
    return NextResponse.json({ error: 'connect_not_ready' }, { status: 503 })
  }
}

export async function GET(req: NextRequest) {
  try {
    const result = await startOnboarding(req)
    const origin = new URL(req.url).origin
    if ('denied' in result) return NextResponse.redirect(`${origin}/settings`)
    if ('error' in result) return NextResponse.redirect(`${origin}/login`)
    return NextResponse.redirect(result.url)
  } catch (err: any) {
    console.error('[connect/onboard] GET error:', err?.message)
    return NextResponse.redirect(`${new URL(req.url).origin}/settings?pagos=pronto`)
  }
}
