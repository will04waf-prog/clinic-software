import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { stripe } from '@/lib/stripe'
import { requireRole, isDenied, OWNER_ONLY } from '@/lib/auth/roles'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await requireRole(supabase, user.id, OWNER_ONLY)
  if (isDenied(gate)) return gate.response

  const { data: org } = await supabase
    .from('organizations')
    .select('stripe_customer_id')
    .eq('id', gate.orgId)
    .single()

  if (!org?.stripe_customer_id) {
    return NextResponse.json({ error: 'No billing account found. Subscribe first.' }, { status: 404 })
  }

  const origin = new URL(req.url).origin

  // Raw Stripe errors log server-side only; the client gets a stable
  // code it maps to friendly copy (same policy as subscribe/checkout).
  try {
    const session = await stripe.billingPortal.sessions.create({
      customer:   org.stripe_customer_id,
      return_url: `${origin}/settings`,
    })
    return NextResponse.json({ url: session.url })
  } catch (err: any) {
    console.error('[billing/portal] Stripe error:', err?.message)
    return NextResponse.json({ error: 'portal_not_ready' }, { status: 503 })
  }
}
