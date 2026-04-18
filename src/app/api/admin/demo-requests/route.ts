import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase/admin'

async function requireSuperAdmin() {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: () => {},
      },
    }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('is_super_admin')
    .eq('id', user.id)
    .single()

  return profile?.is_super_admin ? user : null
}

// GET /api/admin/demo-requests?status=new
export async function GET(request: Request) {
  const user = await requireSuperAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')

  let query = supabaseAdmin
    .from('demo_requests')
    .select('*')
    .order('created_at', { ascending: false })

  if (status && status !== 'all') {
    query = query.eq('status', status)
  }

  const { data, error } = await query

  if (error) {
    console.error('demo_requests GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch.' }, { status: 500 })
  }

  return NextResponse.json({ data })
}

// PATCH /api/admin/demo-requests  body: { id, status }
export async function PATCH(request: Request) {
  const user = await requireSuperAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { id, status } = body

  if (!id || !status) {
    return NextResponse.json({ error: 'id and status are required.' }, { status: 400 })
  }

  const validStatuses = ['new', 'contacted', 'booked', 'completed', 'cancelled']
  if (!validStatuses.includes(status)) {
    return NextResponse.json({ error: 'Invalid status.' }, { status: 400 })
  }

  const { error } = await supabaseAdmin
    .from('demo_requests')
    .update({ status })
    .eq('id', id)

  if (error) {
    console.error('demo_requests PATCH error:', error)
    return NextResponse.json({ error: 'Failed to update.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
