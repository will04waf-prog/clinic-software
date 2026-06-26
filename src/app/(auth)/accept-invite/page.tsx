'use client'

/**
 * Phase 4 W8 — accept-invite landing page.
 *
 * Patient/visitor flow:
 *   1. URL is /accept-invite?token=<base64url>
 *   2. Server peek (optional): we don't pre-fetch the invitation
 *      from this page; we just hand the token to /api/auth/accept-invite
 *      which validates + creates the user atomically. Server-render
 *      would leak invitation metadata into HTML.
 *   3. Invitee enters full name + password (email is locked — it
 *      comes from the invitation row).
 *   4. POST /api/auth/accept-invite. On success, sign in client-side
 *      and push to /dashboard.
 *
 * Defensive: if no token is in the URL, render an invalid-link
 * message instead of a broken form.
 *
 * proxy.ts needs /accept-invite in publicRoutes so an unauthenticated
 * visitor can reach this page.
 */

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { LogoMark } from '@/components/ui/logo-mark'

export default function AcceptInvitePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams.get('token') ?? ''

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    full_name: '',
    password: '',
  })

  function update(key: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function handleAccept(e: React.FormEvent) {
    e.preventDefault()
    if (!token) return
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/auth/accept-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, ...form }),
      })

      const contentType = res.headers.get('content-type') ?? ''
      if (!contentType.includes('application/json')) {
        throw new Error(`Server error (${res.status}). Please try again.`)
      }

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.message ?? data.error ?? 'Could not accept the invitation.')
      }

      // The accept endpoint returns the email the invitation was
      // bound to. Sign the invitee in immediately so they land in
      // the dashboard already authenticated.
      const supabase = createClient()
      await supabase.auth.signInWithPassword({ email: data.email, password: form.password })
      router.push('/dashboard')
      router.refresh()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  if (!token) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center bg-[#F5EFE1] px-4 py-12">
        <div className="mb-8 flex flex-col items-center gap-2">
          <LogoMark size="xl" standalone />
        </div>
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>This link can't be used</CardTitle>
            <CardDescription>
              The invitation link is missing or invalid. Ask the clinic owner to send a fresh invitation.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-[#F5EFE1] px-4 py-12">
      <div className="mb-8 flex flex-col items-center gap-2">
        <LogoMark size="xl" standalone />
        <p className="text-[11px] font-semibold uppercase tracking-widest text-[#028090]">
          You've been invited
        </p>
      </div>

      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Accept your invitation</CardTitle>
          <CardDescription>
            Set up your account to join the team.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAccept} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="full_name">Your Name *</Label>
              <Input
                id="full_name"
                value={form.full_name}
                onChange={(e) => update('full_name', e.target.value)}
                placeholder="Maria Rivera"
                required
                className="focus-visible:ring-[#028090] focus-visible:border-[#028090]"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">Password *</Label>
              <Input
                id="password"
                type="password"
                value={form.password}
                onChange={(e) => update('password', e.target.value)}
                placeholder="Min. 8 characters"
                minLength={8}
                required
                className="focus-visible:ring-[#028090] focus-visible:border-[#028090]"
              />
            </div>

            {error && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {error}
              </div>
            )}

            <Button
              type="submit"
              disabled={loading}
              className="w-full bg-[#02C39A] hover:bg-[#04B08C]"
            >
              {loading ? 'Setting up…' : 'Accept & continue'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
