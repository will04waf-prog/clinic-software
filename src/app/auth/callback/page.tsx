/**
 * Client-side auth callback.
 *
 * Explicitly parses the URL hash for Supabase implicit-flow tokens
 * (#access_token=...&refresh_token=...) or the ?code= query param for
 * PKCE flow, then sets the session and redirects to ?next. Runs in the
 * browser because server code cannot see URL hashes.
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

    const hashRaw = window.location.hash.startsWith('#')
      ? window.location.hash.slice(1)
      : window.location.hash
    const hashParams = new URLSearchParams(hashRaw)

    const hashError = hashParams.get('error_code') ?? hashParams.get('error')
    if (hashError) {
      console.warn('[auth/callback] hash error:', hashError)
      router.replace('/forgot-password?error=expired')
      return
    }

    const accessToken = hashParams.get('access_token')
    const refreshToken = hashParams.get('refresh_token')
    const code = searchParams.get('code')

    const finish = (ok: boolean) => {
      router.replace(ok ? next : '/forgot-password?error=expired')
    }

    if (accessToken && refreshToken) {
      supabase.auth
        .setSession({ access_token: accessToken, refresh_token: refreshToken })
        .then(({ error }) => {
          if (error) console.warn('[auth/callback] setSession failed:', error.message)
          finish(!error)
        })
    } else if (code) {
      supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
        if (error) console.warn('[auth/callback] exchangeCodeForSession failed:', error.message)
        finish(!error)
      })
    } else {
      console.warn('[auth/callback] no token or code in URL')
      finish(false)
    }
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
