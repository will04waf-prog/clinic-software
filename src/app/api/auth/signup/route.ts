import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { slugify } from '@/lib/utils'

// Use the service role key so we can bypass RLS during org creation
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  // ── Guard: catch missing env vars immediately ──────────────
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL.includes('your-project') ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY === 'your-service-role-key'
  ) {
    console.error('[signup] Supabase env vars are missing or still set to placeholders.')
    return NextResponse.json(
      { error: 'Server is not configured yet. Please set Supabase environment variables.' },
      { status: 503 }
    )
  }

  try {
    const body = await req.json()
    const { clinic_name, full_name, email, password } = body

    if (!clinic_name || !full_name || !email || !password) {
      return NextResponse.json({ error: 'All fields are required.' }, { status: 400 })
    }

    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 })
    }

    // 1. Create auth user
    console.log('[signup] Creating auth user:', email)
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })

    if (authError) {
      console.error('[signup] Auth user creation failed:', authError.message)
      return NextResponse.json({ error: authError.message }, { status: 400 })
    }

    console.log('[signup] Auth user created:', authData.user.id)
    const userId = authData.user.id

    try {
      // 2. Create organization
      console.log('[signup] Creating organization:', clinic_name)
      const slug = slugify(clinic_name) + '-' + userId.slice(0, 6)
      const { data: org, error: orgError } = await supabaseAdmin
        .from('organizations')
        .insert({ name: clinic_name, slug })
        .select('id')
        .single()

      if (orgError) {
        console.error('[signup] Org creation failed:', orgError.message)
        throw new Error(orgError.message)
      }

      console.log('[signup] Organization created:', org.id)
      const orgId = org.id

      // 3. Create profile
      console.log('[signup] Creating profile for user:', userId)
      const { error: profileError } = await supabaseAdmin.from('profiles').insert({
        id: userId,
        organization_id: orgId,
        full_name,
        email,
        role: 'owner',
      })

      if (profileError) {
        console.error('[signup] Profile creation failed:', profileError.message)
        throw new Error(profileError.message)
      }

      console.log('[signup] Profile created.')

      // 4. Seed default pipeline stages
      console.log('[signup] Seeding pipeline stages...')
      const { error: stagesError } = await supabaseAdmin.rpc('seed_default_stages', {
        org_id: orgId,
      })

      if (stagesError) {
        console.error('[signup] Stage seeding failed:', stagesError.message)
        throw new Error(stagesError.message)
      }

      console.log('[signup] Signup complete for:', email)
      return NextResponse.json({ ok: true })

    } catch (innerErr: any) {
      // Roll back auth user if anything downstream fails
      console.error('[signup] Rolling back auth user due to error:', innerErr.message)
      await supabaseAdmin.auth.admin.deleteUser(userId)
      return NextResponse.json({ error: innerErr.message }, { status: 500 })
    }

  } catch (outerErr: any) {
    // Catch anything not already handled — parse errors, network errors, etc.
    console.error('[signup] Unhandled error:', outerErr.message)
    return NextResponse.json(
      { error: 'An unexpected error occurred. Please try again.' },
      { status: 500 }
    )
  }
}
