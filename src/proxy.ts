import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { blockedReason } from '@/lib/billing/org-access'

// Pure static marketing/legal routes: no auth logic applies to them, so
// skip the createServerClient + auth.getUser() network round-trip entirely.
// This is the biggest avoidable TTFB cost on the Spanish landing/demo
// pages (every anon visitor was paying a JWT validation over the network
// on fully-static HTML). NOT including '/', '/login', '/signup' — those
// carry a logged-in → /dashboard redirect and must keep running.
// Route archaeology 2026-07-15: '/pricing' and '/demo' removed — those
// pages are deleted and 301 to '/' via next.config redirects, which run
// BEFORE this proxy, so listing them here was dead config.
export const STATIC_PUBLIC = ['/es', '/trades', '/limpieza', '/construccion', '/privacy', '/terms', '/sms-consent', '/voice-consent', '/book-demo']

// Unauthenticated routes: no login redirect, no plan lockout.
export const PUBLIC_ROUTES = ['/login', '/signup', '/forgot-password', '/reset-password', '/auth/callback', '/capture', '/billing', '/med-spa-crm', '/book-demo', '/privacy', '/terms', '/sms-consent', '/voice-consent', '/sitemap.xml', '/robots.txt', '/icon.svg', '/book', '/manage', '/aprobar', '/pagar', '/accept-invite', '/es', '/trades', '/limpieza', '/construccion']

// Boundary match — a route matches a prefix only at a real path boundary,
// never mid-segment. Bare startsWith made '/estimates' match '/es',
// classifying the whole authenticated estimates section as public.
export function matchesRoute(pathname: string, routes: readonly string[]): boolean {
  return routes.some((r) => pathname === r || pathname.startsWith(r + '/'))
}

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname
  if (matchesRoute(path, STATIC_PUBLIC)) {
    return NextResponse.next({ request })
  }

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  const pathname = request.nextUrl.pathname

  // ── Admin route protection ─────────────────────────────────
  if (pathname.startsWith('/admin')) {
    if (!user) {
      return NextResponse.redirect(new URL('/login', request.url))
    }
    // Check is_super_admin via a lightweight direct fetch
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_super_admin')
      .eq('id', user.id)
      .single()

    if (!profile?.is_super_admin) {
      return NextResponse.redirect(new URL('/dashboard', request.url))
    }

    return supabaseResponse
  }

  // ── Standard auth routes ───────────────────────────────────
  const isPublic = matchesRoute(pathname, PUBLIC_ROUTES)

  if (!user && !isPublic && pathname !== '/') {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  if (user && (pathname === '/login' || pathname === '/signup' || pathname === '/')) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  // ── Plan lockout enforcement (trial_expired / canceled / suspended) ──
  // Only check for logged-in users on protected routes.
  // /settings and /billing must stay accessible so they can (re)subscribe.
  if (user && !isPublic && pathname !== '/' &&
      !pathname.startsWith('/settings') &&
      !pathname.startsWith('/billing') &&
      !pathname.startsWith('/admin') &&
      !pathname.startsWith('/onboarding')) {

    const { data: profileData } = await supabase
      .from('profiles')
      .select('organization:organizations(plan_status, trial_ends_at)')
      .eq('id', user.id)
      .single()

    const org = profileData?.organization as any
    if (blockedReason(org?.plan_status, org?.trial_ends_at)) {
      return NextResponse.redirect(new URL('/settings', request.url))
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|api/|.*\\..*).*)'],
}
