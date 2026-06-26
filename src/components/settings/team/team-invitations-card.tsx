'use client'

/**
 * Phase 4 W8 — pending team invitations + invite-teammate button.
 *
 * Owner-only. Lists invitations that haven't been accepted or
 * revoked, with the expiration date and a Revoke action. The
 * "Invite teammate" button opens a small Dialog with email + role
 * select.
 */

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Loader2, Mail, Plus, X, Send } from 'lucide-react'
import {
  Card, CardContent, CardHeader, CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { UpgradeCardLocked, type RequiredTier } from '@/components/billing/upgrade-card-locked'

interface Invitation {
  id: string
  email: string
  role: 'admin' | 'staff'
  expires_at: string
  created_at: string
}

const ROLE_LABEL: Record<Invitation['role'], string> = {
  admin: 'Admin',
  staff: 'Staff',
}

export function TeamInvitationsCard({ currentUserId }: { currentUserId: string }) {
  void currentUserId

  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState<string | null>(null)

  // W9 Fix #18 — keep row-action errors distinct from the top-level
  // load error so a failed Resend/Revoke doesn't wipe out the list.
  const [actionError, setActionError] = useState<string | null>(null)

  // W9 Fix #17 — fail-open seat indicator. If /api/org/team/seats
  // returns a non-ok we show a subtle "Seat usage unavailable" note
  // but leave the Invite button enabled rather than locking out an
  // owner because of an internal infrastructure error.
  const [seatsError, setSeatsError] = useState(false)

  // W9 Fix #19 — track which row has an in-flight resend so a
  // double-tap doesn't fire two POSTs (which would bump resend_count
  // twice and send two emails). Same idea for revoke for symmetry.
  const [resendingId, setResendingId] = useState<string | null>(null)
  const [revokingId, setRevokingId]   = useState<string | null>(null)

  const [open, setOpen]         = useState(false)
  const [email, setEmail]       = useState('')
  const [role, setRole]         = useState<Invitation['role']>('staff')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError]   = useState<string | null>(null)

  // W9 seat indicator. Loaded alongside the invitations so the
  // header can show "3 of 5 seats used" and the Invite button can
  // pre-render a locked state when at cap.
  const [seats, setSeats] = useState<{
    tier: string
    cap: number | 'unlimited'
    used: number
    active: number
    pending: number
  } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setSeatsError(false)
    try {
      const [invRes, seatsRes] = await Promise.all([
        fetch('/api/org/team/invitations', { cache: 'no-store' }),
        fetch('/api/org/team/seats',       { cache: 'no-store' }),
      ])
      if (!invRes.ok) throw new Error('Could not load invitations')
      const j = await invRes.json()
      setInvitations(Array.isArray(j.invitations) ? j.invitations : [])
      if (seatsRes.ok) {
        try {
          const s = await seatsRes.json()
          setSeats(s)
        } catch {
          // Malformed body — treat as fail-open: surface the
          // "usage unavailable" indicator but leave Invite enabled.
          setSeats(null)
          setSeatsError(true)
        }
      } else {
        // W9 Fix #17 — fail-open. Don't block invites just because
        // the seats endpoint is having a bad day.
        setSeats(null)
        setSeatsError(true)
      }
    } catch (err: any) {
      setError(err?.message ?? 'Could not load invitations')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { load() }, [load])

  const atCap =
    seats !== null && seats.cap !== 'unlimited' && seats.used >= seats.cap

  function openInviteDialog() {
    setEmail('')
    setRole('staff')
    setFormError(null)
    setOpen(true)
  }

  async function submit() {
    const trimmed = email.trim()
    if (!trimmed) {
      setFormError('Enter an email address')
      return
    }
    setSubmitting(true)
    setFormError(null)
    try {
      const res = await fetch('/api/org/team/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmed, role }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.message ?? j.error ?? 'Could not send invitation')
      }
      setOpen(false)
      await load()
    } catch (err: any) {
      setFormError(err?.message ?? 'Could not send invitation')
    } finally {
      setSubmitting(false)
    }
  }

  async function resend(id: string) {
    // W9 Fix #19 — guard against double-tap. Without this, two quick
    // taps fire two POSTs which both increment resend_count and send
    // two emails.
    if (resendingId) return
    setResendingId(id)
    setActionError(null)
    try {
      const res = await fetch(`/api/org/team/invitations/${id}/resend`, { method: 'POST' })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.message ?? j.error ?? 'Could not re-send')
      }
      await load()
    } catch (err: any) {
      // W9 Fix #18 — surface as an action banner, NOT as a list
      // replacement. The list of invitations should keep rendering.
      setActionError(err?.message ?? 'Could not re-send')
    } finally {
      setResendingId(null)
    }
  }

  async function revoke(id: string) {
    if (revokingId) return
    if (!confirm('Revoke this invitation? The link in their email will stop working.')) return
    setRevokingId(id)
    setActionError(null)
    try {
      const res = await fetch(`/api/org/team/invitations/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.message ?? j.error ?? 'Could not revoke')
      }
      await load()
    } catch (err: any) {
      setActionError(err?.message ?? 'Could not revoke')
    } finally {
      setRevokingId(null)
    }
  }

  // W9 Fix #16 — when the org is at its seat cap, render an upgrade
  // banner above the list with a real path forward (not just a
  // disabled button + tooltip). Owners on Starter/Professional jump
  // one tier; Scale orgs are already unlimited so this never renders.
  const upgradeTarget: RequiredTier =
    seats?.tier === 'professional' ? 'scale' : 'professional'

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-brand-600" />
              Invitations
            </CardTitle>
            {seats && (
              <p className="mt-1 text-[11.5px] text-gray-500">
                {seats.used} of {seats.cap === 'unlimited' ? '∞' : seats.cap} seats used
                {atCap && seats.cap !== 'unlimited' && (
                  <span className="ml-1.5 inline-flex items-center rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                    At cap
                  </span>
                )}
              </p>
            )}
            {seatsError && (
              // W9 Fix #17 — fail-open. Tell the owner the count is
              // stale; don't lock them out of inviting.
              <p className="mt-1 inline-flex items-center gap-1 text-[11.5px] text-amber-700">
                <AlertTriangle className="h-3 w-3" aria-hidden />
                Seat usage unavailable
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={openInviteDialog}
            disabled={atCap}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
              atCap
                ? 'cursor-not-allowed bg-gray-200 text-gray-400'
                : 'bg-brand-600 text-white hover:bg-brand-700'
            }`}
            title={atCap ? 'You are at your seat cap — upgrade or deactivate a teammate to invite' : undefined}
          >
            <Plus className="h-3.5 w-3.5" />
            Invite teammate
          </button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {/* W9 Fix #16 — at-cap upgrade banner. Renders above the list
            so the owner has a real path forward, not just a disabled
            Invite button + tooltip. */}
        {atCap && seats && (
          <UpgradeCardLocked
            requiredTier={upgradeTarget}
            capability="Team seats"
            currentTier={seats.tier}
            bullets={[
              'Up to 5 teammates on Pro',
              'Unlimited teammates on Scale',
              'Same role-based access controls',
            ]}
          />
        )}

        {/* W9 Fix #18 — row-action error banner. Dismissible, sits
            above the list. We do NOT replace the list with it — only
            the top-level load failure does that. */}
        {actionError && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
          >
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <p className="flex-1">{actionError}</p>
            <button
              type="button"
              onClick={() => setActionError(null)}
              aria-label="Dismiss"
              className="rounded p-0.5 text-red-700 hover:bg-red-100"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {loading ? (
          <p className="text-gray-400">Loading…</p>
        ) : error ? (
          <p className="text-red-600">{error}</p>
        ) : invitations.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center">
            <p className="text-sm font-medium text-gray-700">No pending invitations</p>
            <p className="mt-1 text-xs text-gray-500">
              Tap <strong>Invite teammate</strong> to send a signup link by email.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {invitations.map((inv) => {
              const isResending = resendingId === inv.id
              const isRevoking  = revokingId === inv.id
              return (
                <li key={inv.id} className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-gray-900 truncate">{inv.email}</p>
                      <Badge variant={inv.role === 'admin' ? 'default' : 'secondary'}>
                        {ROLE_LABEL[inv.role]}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-gray-500">
                      Expires {new Date(inv.expires_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => resend(inv.id)}
                    disabled={isResending || isRevoking}
                    className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
                    aria-label="Re-send email"
                    aria-busy={isResending}
                    title={isResending ? 'Sending…' : 'Re-send invitation email'}
                  >
                    {isResending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Send className="h-3.5 w-3.5" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => revoke(inv.id)}
                    disabled={isResending || isRevoking}
                    className="rounded-lg p-1.5 text-gray-500 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-gray-500"
                    aria-label="Revoke"
                    aria-busy={isRevoking}
                  >
                    {isRevoking ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <X className="h-3.5 w-3.5" />
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={(o) => { if (!o) { setOpen(false); setFormError(null) } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite a teammate</DialogTitle>
            <DialogDescription>
              They'll get an email with a link to set up their account.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="invite-email">Email *</Label>
              <Input
                id="invite-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="teammate@clinic.com"
                disabled={submitting}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Role *</Label>
              <div className="space-y-2">
                <label
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${
                    role === 'admin' ? 'border-[#02C39A] bg-[#02C39A]/8' : 'border-gray-200 bg-white'
                  }`}
                >
                  <input
                    type="radio"
                    name="role"
                    value="admin"
                    checked={role === 'admin'}
                    onChange={() => setRole('admin')}
                    className="mt-1 h-4 w-4"
                  />
                  <div>
                    <p className="text-sm font-medium text-gray-900">Admin</p>
                    <p className="text-xs text-gray-500">
                      Everything except billing + team management.
                    </p>
                  </div>
                </label>
                <label
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${
                    role === 'staff' ? 'border-[#02C39A] bg-[#02C39A]/8' : 'border-gray-200 bg-white'
                  }`}
                >
                  <input
                    type="radio"
                    name="role"
                    value="staff"
                    checked={role === 'staff'}
                    onChange={() => setRole('staff')}
                    className="mt-1 h-4 w-4"
                  />
                  <div>
                    <p className="text-sm font-medium text-gray-900">Staff</p>
                    <p className="text-xs text-gray-500">
                      Day-to-day: book consults, edit availability, manage contacts.
                    </p>
                  </div>
                </label>
              </div>
            </div>
            {formError && (
              <p className="rounded-md border border-red-200 bg-red-50 px-2.5 py-2 text-xs text-red-700">{formError}</p>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button size="sm" onClick={submit} disabled={submitting}>
                {submitting ? 'Sending…' : 'Send invitation'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
