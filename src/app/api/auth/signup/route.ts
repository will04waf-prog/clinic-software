import { NextRequest, NextResponse, after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { slugify } from '@/lib/utils'
import { sendWelcomeEmail } from '@/lib/welcome-email'

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
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })

    if (authError) {
      console.error('[signup] Auth user creation failed:', authError.message)
      return NextResponse.json({ error: authError.message }, { status: 400 })
    }

    const userId = authData.user.id

    try {
      // 2. Create organization
      const slug = slugify(clinic_name) + '-' + userId.slice(0, 6)
      const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
      // plan_status MUST be 'trial' — the trial banner, the 7/3/1-day
      // reminder emails, the expire-trials cron, the proxy lockout, and
      // the Scale-equivalent-during-trial rule (org-tier.ts) all key on
      // it. The schema default was 'active', which left every self-serve
      // signup on un-expiring Professional access with no trial UX.
      const { data: org, error: orgError } = await supabaseAdmin
        .from('organizations')
        .insert({ name: clinic_name, slug, trial_ends_at: trialEndsAt, plan: 'trial', plan_status: 'trial' })
        .select('id')
        .single()

      if (orgError) {
        console.error('[signup] Org creation failed:', orgError.message)
        throw new Error(orgError.message)
      }

      const orgId = org.id

      // 3. Create profile
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

      // 4. Seed default pipeline stages
      const { error: stagesError } = await supabaseAdmin.rpc('seed_default_stages', {
        org_id: orgId,
      })

      if (stagesError) {
        console.error('[signup] Stage seeding failed:', stagesError.message)
        throw new Error(stagesError.message)
      }

      // 5. Day-0 welcome email via after() — the sanctioned post-
      // response mechanism (a bare un-awaited promise gets frozen when
      // the lambda suspends after the response, silently dropping the
      // send AND its error log). Still non-fatal: a Resend hiccup must
      // never fail the signup the owner just completed.
      after(async () => {
        try {
          await sendWelcomeEmail({
            orgId: orgId,
            orgName: clinic_name,
            ownerEmail: email,
            ownerFullName: full_name,
            trialEndsAt: trialEndsAt,
          })
        } catch (err) {
          console.error('[signup] welcome email failed (non-fatal):', err instanceof Error ? err.message : err)
        }
      })

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
