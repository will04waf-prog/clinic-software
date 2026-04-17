'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { slugify } from '@/lib/utils'

export default function SignupPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    clinic_name: '',
    full_name: '',
    email: '',
    password: '',
  })

  function update(key: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })

      const contentType = res.headers.get('content-type') ?? ''
      if (!contentType.includes('application/json')) {
        throw new Error(`Server error (${res.status}). Please try again.`)
      }

      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Signup failed')

      // Sign in immediately
      const supabase = createClient()
      await supabase.auth.signInWithPassword({ email: form.email, password: form.password })
      router.push('/onboarding')
      router.refresh()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-gray-50 px-4 py-12">
      <div className="mb-8 flex flex-col items-center gap-2">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-600 shadow-lg">
          <span className="text-2xl font-black text-white">T</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900">Tarhunna</h1>
        <p className="text-sm text-gray-500">Start your 14-day free trial</p>
      </div>

      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Create your account</CardTitle>
          <CardDescription>Set up your clinic in under 2 minutes.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSignup} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="clinic_name">Clinic Name *</Label>
              <Input
                id="clinic_name"
                value={form.clinic_name}
                onChange={(e) => update('clinic_name', e.target.value)}
                placeholder="Miami Aesthetics Center"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="full_name">Your Name *</Label>
              <Input
                id="full_name"
                value={form.full_name}
                onChange={(e) => update('full_name', e.target.value)}
                placeholder="Dr. Maria Rivera"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="email">Email *</Label>
              <Input
                id="email"
                type="email"
                value={form.email}
                onChange={(e) => update('email', e.target.value)}
                placeholder="you@clinic.com"
                required
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
              />
            </div>

            {error && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2">
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Creating account...' : 'Start Free Trial'}
            </Button>

            <p className="text-center text-xs text-gray-400">
              No credit card required. 14-day trial.
            </p>
          </form>

          <p className="mt-4 text-center text-sm text-gray-500">
            Already have an account?{' '}
            <Link href="/login" className="text-indigo-600 hover:underline font-medium">
              Sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
