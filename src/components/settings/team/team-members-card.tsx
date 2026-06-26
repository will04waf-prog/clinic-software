'use client'

/**
 * Phase 4 W8 — list active + inactive team members.
 *
 * Owner-only mutations: change role (admin/staff/owner) or
 * deactivate (soft delete via is_active=false). Soft-deleted rows
 * stay in the DB to preserve consultation authorship + contact
 * history. Same +N inactive show/hide pattern as providers/services.
 */

import { useCallback, useEffect, useState } from 'react'
import { Trash2, ShieldCheck } from 'lucide-react'
import {
  Card, CardContent, CardHeader, CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

interface Member {
  id: string
  full_name: string
  email: string
  role: 'owner' | 'admin' | 'staff'
  is_active: boolean
  created_at: string
}

const ROLE_LABEL: Record<Member['role'], string> = {
  owner: 'Owner',
  admin: 'Admin',
  staff: 'Staff',
}

const ROLE_BADGE: Record<Member['role'], 'success' | 'default' | 'secondary'> = {
  owner: 'success',
  admin: 'default',
  staff: 'secondary',
}

export function TeamMembersCard({ currentUserId }: { currentUserId: string }) {
  const [members, setMembers]       = useState<Member[]>([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState<string | null>(null)
  const [showInactive, setShowInactive] = useState(false)
  const [editing, setEditing]       = useState<Member | null>(null)
  const [editRole, setEditRole]     = useState<Member['role']>('staff')
  const [saving, setSaving]         = useState(false)
  const [editError, setEditError]   = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/org/team', { cache: 'no-store' })
      if (!res.ok) throw new Error('Could not load team members')
      const j = await res.json()
      setMembers(Array.isArray(j.members) ? j.members : [])
    } catch (err: any) {
      setError(err?.message ?? 'Could not load team members')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { load() }, [load])

  function startEdit(m: Member) {
    setEditing(m)
    setEditRole(m.role)
    setEditError(null)
  }

  async function saveRole() {
    if (!editing) return
    setSaving(true)
    setEditError(null)
    try {
      const res = await fetch(`/api/org/team/${editing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: editRole }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.message ?? j.error ?? 'Could not change role')
      }
      setEditing(null)
      await load()
    } catch (err: any) {
      setEditError(err?.message ?? 'Could not change role')
    } finally {
      setSaving(false)
    }
  }

  async function deactivate(m: Member) {
    if (m.id === currentUserId) {
      if (!confirm('Deactivate your own account? You will be signed out and will no longer be able to access this clinic.')) return
    } else {
      if (!confirm(`Deactivate ${m.full_name || m.email}? They keep their history but lose all access.`)) return
    }
    try {
      const res = await fetch(`/api/org/team/${m.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: false }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.message ?? j.error ?? 'Could not deactivate')
      }
      await load()
    } catch (err: any) {
      setError(err?.message ?? 'Could not deactivate')
    }
  }

  async function reactivate(m: Member) {
    try {
      const res = await fetch(`/api/org/team/${m.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: true }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.message ?? j.error ?? 'Could not reactivate')
      }
      await load()
    } catch (err: any) {
      setError(err?.message ?? 'Could not reactivate')
    }
  }

  const visible = showInactive ? members : members.filter((m) => m.is_active)
  const inactiveCount = members.filter((m) => !m.is_active).length

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-brand-600" />
          Members
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm">
        {loading ? (
          <p className="text-gray-400">Loading…</p>
        ) : error ? (
          <p className="text-red-600">{error}</p>
        ) : (
          <>
            <ul className="space-y-2">
              {visible.map((m) => (
                <li
                  key={m.id}
                  className={`flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-3 ${
                    m.is_active ? '' : 'opacity-60'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-gray-900 truncate">
                        {m.full_name || m.email}
                        {m.id === currentUserId && (
                          <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                            (you)
                          </span>
                        )}
                      </p>
                      <Badge variant={ROLE_BADGE[m.role]}>{ROLE_LABEL[m.role]}</Badge>
                      {!m.is_active && (
                        <Badge variant="secondary">Deactivated</Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-gray-500 truncate">{m.email}</p>
                  </div>
                  {m.is_active ? (
                    <>
                      <button
                        type="button"
                        onClick={() => startEdit(m)}
                        className="rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                      >
                        Role
                      </button>
                      <button
                        type="button"
                        onClick={() => deactivate(m)}
                        className="rounded-lg p-1.5 text-gray-500 hover:bg-red-50 hover:text-red-600"
                        aria-label="Deactivate"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => reactivate(m)}
                      className="rounded-md border border-[#02C39A]/40 bg-white px-2.5 py-1 text-xs font-medium text-[#04B08C] hover:bg-[#02C39A]/10"
                    >
                      Reactivate
                    </button>
                  )}
                </li>
              ))}
            </ul>

            {inactiveCount > 0 && (
              <button
                type="button"
                onClick={() => setShowInactive((v) => !v)}
                className="mt-3 text-xs font-medium text-gray-500 hover:text-gray-700"
              >
                {showInactive
                  ? `Hide ${inactiveCount} deactivated`
                  : `+${inactiveCount} deactivated — show`}
              </button>
            )}
          </>
        )}
      </CardContent>

      {/* ── Role-change dialog ── */}
      <Dialog open={editing !== null} onOpenChange={(o) => { if (!o) { setEditing(null); setEditError(null) } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change role</DialogTitle>
            <DialogDescription>
              {editing?.full_name || editing?.email} will get the permissions of the selected role immediately.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {(['owner', 'admin', 'staff'] as const).map((r) => (
              <label
                key={r}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${
                  editRole === r ? 'border-[#02C39A] bg-[#02C39A]/8' : 'border-gray-200 bg-white'
                }`}
              >
                <input
                  type="radio"
                  name="role"
                  value={r}
                  checked={editRole === r}
                  onChange={() => setEditRole(r)}
                  className="mt-1 h-4 w-4"
                />
                <div>
                  <Label className="font-medium text-gray-900">{ROLE_LABEL[r]}</Label>
                  <p className="text-xs text-gray-500">
                    {r === 'owner'   && 'Full access — billing, team, settings, everything.'}
                    {r === 'admin'   && 'Everything except billing + team management.'}
                    {r === 'staff'   && 'Day-to-day: book consults, edit availability, manage contacts.'}
                  </p>
                </div>
              </label>
            ))}
            {editError && (
              <p className="rounded-md border border-red-200 bg-red-50 px-2.5 py-2 text-xs text-red-700">{editError}</p>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={() => setEditing(null)} disabled={saving}>
                Cancel
              </Button>
              <Button size="sm" onClick={saveRole} disabled={saving || editRole === editing?.role}>
                {saving ? 'Saving…' : 'Save role'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
