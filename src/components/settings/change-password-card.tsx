'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { validatePassword } from '@/lib/password'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface ChangePasswordCardProps {
  userEmail: string
}

export function ChangePasswordCard({ userEmail }: ChangePasswordCardProps) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(false)

    const validationError = validatePassword(next)
    if (validationError) {
      setError(validationError)
      return
    }
    if (next !== confirm) {
      setError('New passwords do not match.')
      return
    }
    if (next === current) {
      setError('New password must be different from your current password.')
      return
    }

    setLoading(true)
    const supabase = createClient()

    // Verify current password by re-authenticating.
    const { error: reauthError } = await supabase.auth.signInWithPassword({
      email: userEmail,
      password: current,
    })

    if (reauthError) {
      setLoading(false)
      setError('Current password is incorrect.')
      return
    }

    const { error: updateError } = await supabase.auth.updateUser({ password: next })
    setLoading(false)

    if (updateError) {
      setError('Could not update password. Please try again.')
      return
    }

    setSuccess(true)
    setCurrent('')
    setNext('')
    setConfirm('')
  }

  return (
    <div className="pt-3 border-t border-gray-100">
      <p className="text-sm font-medium text-gray-900 mb-3">Change password</p>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="current-password" className="text-xs text-gray-500">
            Current password
          </Label>
          <Input
            id="current-password"
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="new-password" className="text-xs text-gray-500">
            New password
          </Label>
          <Input
            id="new-password"
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            placeholder="At least 8 characters"
            autoComplete="new-password"
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="confirm-password" className="text-xs text-gray-500">
            Confirm new password
          </Label>
          <Input
            id="confirm-password"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            required
          />
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        {success && (
          <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2">
            <p className="text-sm text-emerald-700">Password updated.</p>
          </div>
        )}

        <Button type="submit" disabled={loading} size="sm">
          {loading ? 'Updating...' : 'Update password'}
        </Button>
      </form>
    </div>
  )
}
