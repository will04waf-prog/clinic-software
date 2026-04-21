'use client'
import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Logo } from '@/components/ui/logo'

function ForgotPasswordInner() {
  const searchParams = useSearchParams()
  const linkError = searchParams.get('error')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
    } catch {
      // Intentionally swallow — we always show the same neutral message.
    } finally {
      setSubmitted(true)
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-gray-50 px-4 py-12">
      <div className="mb-8 flex flex-col items-center gap-2">
        <Logo size="lg" />
        <p className="text-sm text-gray-500">CRM for Aesthetic Clinics</p>
      </div>

      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Reset your password</CardTitle>
          <CardDescription>
            Enter your email and we&rsquo;ll send you a link to reset your password.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {linkError && !submitted && (
            <div className="mb-4 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5">
              <p className="text-sm text-amber-700">
                Your previous reset link expired or was invalid. Enter your email below to get a new one.
              </p>
            </div>
          )}
          {submitted ? (
            <div className="space-y-4">
              <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-3">
                <p className="text-sm text-emerald-700">
                  If an account exists for this email, we&rsquo;ve sent a reset link. Check your inbox and spam folder.
                </p>
              </div>
              <Link
                href="/login"
                className="block text-center text-sm text-indigo-600 hover:underline font-medium"
              >
                Back to sign in
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@clinic.com"
                  required
                  autoFocus
                />
              </div>

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Sending...' : 'Send reset link'}
              </Button>

              <p className="text-center text-sm text-gray-500">
                Remembered it?{' '}
                <Link href="/login" className="text-indigo-600 hover:underline font-medium">
                  Back to sign in
                </Link>
              </p>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ForgotPasswordInner />
    </Suspense>
  )
}
