/**
 * GET /auth/callback
 * Handles the Supabase PKCE redirect from email verification links
 * (password reset, email confirm, magic link). Exchanges the ?code
 * for a session cookie, then redirects to ?next (default /dashboard).
 *
 * On expired/invalid codes, redirects to /forgot-password?error=expired
 * so the user can request a fresh link.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const next = url.searchParams.get('next') ?? '/dashboard'

  if (!code) {
    return NextResponse.redirect(new URL('/forgot-password?error=invalid', req.url))
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    console.warn('[auth/callback] exchange failed:', error.message)
    return NextResponse.redirect(new URL('/forgot-password?error=expired', req.url))
  }

  return NextResponse.redirect(new URL(next, req.url))
}
