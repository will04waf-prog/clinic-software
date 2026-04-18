import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
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
  const publicRoutes = ['/login', '/signup', '/capture', '/billing', '/med-spa-crm', '/sitemap.xml', '/robots.txt', '/icon.svg']
  const isPublic = publicRoutes.some((r) => pathname.startsWith(r))

  if (!user && !isPublic && pathname !== '/') {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  if (user && (pathname === '/login' || pathname === '/signup' || pathname === '/')) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  // ── Trial expiration enforcement ───────────────────────────
  // Only check for logged-in users on protected routes.
  // /settings and /billing must stay accessible so they can subscribe.
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
    const trialExpired =
      org?.plan_status === 'trial_expired' ||
      (org?.plan_status === 'trial' &&
       org?.trial_ends_at &&
       new Date(org.trial_ends_at) < new Date())

    if (trialExpired) {
      return NextResponse.redirect(new URL('/settings', request.url))
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|favicon.png|sitemap.xml|robots.txt|icon.svg|api/).*)'],
}
