/**
 * Client-side auth callback.
 *
 * Handles Supabase redirects from email verification links (password
 * reset, magic link, email confirm). We run in the browser because
 * Supabase emits session tokens in the URL hash (`#access_token=...`)
 * when the reset is initiated server-side — the hash is invisible to
 * server code. The @supabase/ssr browser client auto-parses both the
 * hash and the `?code=` PKCE query on instantiation, so by the time
 * getSession() resolves, the session is already set in cookies.
 */
'use client'
import { Suspense, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

function CallbackInner() {
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    const next = searchParams.get('next') ?? '/dashboard'
    const supabase = createClient()

    // Browser client auto-detects `#access_token=...` (implicit) or
    // `?code=...` (PKCE) and sets the session on first read.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        router.replace(next)
      } else {
        router.replace('/forgot-password?error=expired')
      }
    })
  }, [router, searchParams])

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <p className="text-sm text-gray-500">Verifying reset link...</p>
    </div>
  )
}

export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-gray-50">
          <p className="text-sm text-gray-500">Verifying reset link...</p>
        </div>
      }
    >
      <CallbackInner />
    </Suspense>
  )
}
