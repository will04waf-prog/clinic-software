'use client'

import { useCallback, useEffect, useState } from 'react'
import { Globe, Copy, Check, Power } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * Phase 4 W2 — Public booking master toggle card.
 *
 * Two things in one card so the owner sees both knobs in one place:
 *   1. The kill switch (booking_enabled on the org row). Off → the
 *      public page renders "Online booking is paused" and every
 *      hold/confirm refuses 403. Existing scheduled rows untouched.
 *   2. The public URL — read-only display + a one-click copy button.
 *      This is the only honest place to surface the URL: the user
 *      has to share it themselves (we don't link out from any
 *      patient-facing surface yet).
 *
 * Loads from /api/booking/org-settings. Saves via PATCH to the
 * same route. Optimistic update so the toggle feels instant; on
 * server error we revert + show the message.
 */

interface State {
  booking_enabled: boolean
  slug: string | null
}

export function BookingMasterToggleCard() {
  const [data, setData]       = useState<State | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')
  const [copied, setCopied]   = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/booking/org-settings', { cache: 'no-store' })
      if (!res.ok) throw new Error('Failed to load booking settings')
      const json = (await res.json()) as State
      setData(json)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { load() }, [load])

  async function toggle() {
    if (!data || saving) return
    const next = !data.booking_enabled
    setData({ ...data, booking_enabled: next }) // optimistic
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/booking/org-settings', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ booking_enabled: next }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.message || j.error || 'Save failed')
      }
    } catch (err: unknown) {
      // Revert + surface the error so the toggle never lies about state.
      setData(prev => prev ? { ...prev, booking_enabled: !next } : prev)
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const publicUrl = typeof window !== 'undefined' && data?.slug
    ? `${window.location.origin}/book/${data.slug}`
    : null

  async function copyUrl() {
    if (!publicUrl) return
    try {
      await navigator.clipboard.writeText(publicUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard can fail under restrictive permissions. Surface
      // honestly rather than pretending the copy worked.
      setError('Could not copy — your browser blocked clipboard access. Select and copy manually.')
    }
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-brand-600" />
            Public booking page
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-gray-400">Loading…</p>
        </CardContent>
      </Card>
    )
  }
  if (!data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-brand-600" />
            Public booking page
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-red-600">{error || 'Booking settings unavailable.'}</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-brand-600" />
          Public booking page
        </CardTitle>
        <p className="mt-1 text-sm text-gray-500">
          A page anyone can visit to pick a service, choose a time, and book themselves
          in — no login required. Bookings flow into your Consultations feed and trigger
          reminders just like the ones you create by hand.
        </p>
      </CardHeader>

      <CardContent className="space-y-5 text-sm">
        {/* ── Master toggle ── */}
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="flex items-center gap-1.5 text-[13px] font-semibold text-gray-900">
                <Power className={`h-3.5 w-3.5 ${data.booking_enabled ? 'text-[#04B08C]' : 'text-gray-400'}`} />
                Accept online bookings
              </p>
              <p className="mt-0.5 text-[12px] text-gray-500">
                {data.booking_enabled
                  ? 'Patients can book themselves from your public page right now.'
                  : 'Page is paused. Visitors see a "paused" notice; nothing books.'}
              </p>
            </div>
            <button
              type="button"
              onClick={toggle}
              disabled={saving}
              aria-pressed={data.booking_enabled}
              className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
                data.booking_enabled ? 'bg-[#02C39A]' : 'bg-gray-300'
              }`}
            >
              <span
                className={`inline-block h-5 w-5 mt-0.5 rounded-full bg-white shadow transition-transform ${
                  data.booking_enabled ? 'translate-x-5' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>
        </div>

        {/* ── Public URL ── */}
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <p className="text-[12px] font-medium text-gray-600">Your public booking URL</p>
          {publicUrl ? (
            <div className="mt-2 flex items-center gap-2">
              <code className="flex-1 truncate rounded bg-gray-100 px-2 py-1.5 text-[12px] font-mono text-gray-700">
                {publicUrl}
              </code>
              <button
                type="button"
                onClick={copyUrl}
                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-[12px] font-medium text-gray-700 hover:bg-gray-50"
              >
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-[#04B08C]" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    Copy
                  </>
                )}
              </button>
            </div>
          ) : (
            <p className="mt-2 text-[12px] text-gray-500 italic">
              Your clinic doesn't have a slug yet — set one in Settings → Clinic to get a public URL.
            </p>
          )}
          <p className="mt-2 text-[11px] text-gray-500">
            Add this link to your Instagram bio, Google Business profile, or as a button on
            your website. Patients who click it land on your branded booking page.
          </p>
        </div>

        {error && (
          <p className="text-xs text-red-600">{error}</p>
        )}
      </CardContent>
    </Card>
  )
}
