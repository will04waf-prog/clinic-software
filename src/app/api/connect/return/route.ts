/**
 * Stripe Connect onboarding `return_url` — where Stripe bounces the owner
 * back after they finish (or bail out of) Express onboarding. Owner is
 * authenticated here (their session cookie rides along), so we resolve
 * the org, retrieve the live account, persist charges/payouts flags, and
 * redirect back to Settings with a status flag the card reads.
 *
 * Returning here does NOT guarantee completion — Stripe may still be
 * verifying — so we branch on the live `charges_enabled`, not on the mere
 * fact of return.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { syncConnectStatus } from '@/lib/stripe/connect'

export async function GET(req: NextRequest) {
  const origin = new URL(req.url).origin
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(`${origin}/login`)

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single()
  if (!profile) return NextResponse.redirect(`${origin}/login`)

  // Read the connect id via service-role (the column isn't in the RLS
  // read set the owner normally selects, and this is a trusted server path).
  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('stripe_connect_id')
    .eq('id', profile.organization_id)
    .single()

  if (!org?.stripe_connect_id) {
    return NextResponse.redirect(`${origin}/settings?pagos=error`)
  }

  try {
    const { chargesEnabled } = await syncConnectStatus(profile.organization_id, org.stripe_connect_id)
    return NextResponse.redirect(`${origin}/settings?pagos=${chargesEnabled ? 'ok' : 'pending'}`)
  } catch (err: any) {
    console.error('[connect/return] sync failed:', err?.message)
    return NextResponse.redirect(`${origin}/settings?pagos=error`)
  }
}
