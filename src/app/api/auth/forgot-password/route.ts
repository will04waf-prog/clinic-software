/**
 * POST /api/auth/forgot-password
 * Always returns 200 to avoid leaking which emails are registered.
 *
 * Throttle: max 3 requests per email per hour, enforced via
 * public.password_reset_throttle (service-role only, RLS on).
 *
 * Uses the anon key client to call resetPasswordForEmail so that
 * Supabase sends the email. The admin client is used only for the
 * throttle table, since that table has RLS on with zero policies.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://tarhunna.net'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const MAX_PER_HOUR = 3

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const rawEmail = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''

    // Minimal email shape check. Don't return 400 on missing — keep response uniform.
    if (!rawEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
      return NextResponse.json({ ok: true })
    }

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()

    const { count } = await supabaseAdmin
      .from('password_reset_throttle')
      .select('*', { count: 'exact', head: true })
      .eq('email', rawEmail)
      .gte('attempted_at', oneHourAgo)

    if ((count ?? 0) >= MAX_PER_HOUR) {
      console.info(`[forgot-password] throttled: ${rawEmail} (count=${count})`)
      return NextResponse.json({ ok: true })
    }

    // Record the attempt BEFORE calling Supabase so a crash mid-send still counts.
    await supabaseAdmin.from('password_reset_throttle').insert({ email: rawEmail })

    const { error } = await supabaseAnon.auth.resetPasswordForEmail(rawEmail, {
      redirectTo: `${APP_URL}/auth/callback?next=/reset-password`,
    })

    if (error) {
      // Log but don't leak — user sees the same neutral message either way.
      console.error(`[forgot-password] supabase error for ${rawEmail}:`, error.message)
    }

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error('[forgot-password] unhandled:', err?.message ?? err)
    return NextResponse.json({ ok: true })
  }
}
