import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { stripe } from '@/lib/stripe'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization:organizations(stripe_customer_id)')
    .eq('id', user.id)
    .single()

  const org = profile?.organization as any
  if (!org?.stripe_customer_id) {
    return NextResponse.json({ error: 'No billing account found. Subscribe first.' }, { status: 404 })
  }

  const origin = new URL(req.url).origin

  const session = await stripe.billingPortal.sessions.create({
    customer:   org.stripe_customer_id,
    return_url: `${origin}/settings`,
  })

  return NextResponse.json({ url: session.url })
}
