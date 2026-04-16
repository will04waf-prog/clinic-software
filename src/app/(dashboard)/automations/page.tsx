'use client'
import { useCallback, useEffect, useState } from 'react'
import { Plus, Zap, Pencil, Trash2, ToggleLeft, ToggleRight } from 'lucide-react'

function AutomationsSkeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="h-2.5 w-2.5 rounded-full bg-gray-200" />
            <div className="space-y-1.5">
              <div className="h-3.5 w-32 rounded bg-gray-200" />
              <div className="h-3 w-20 rounded bg-gray-100" />
            </div>
          </div>
          <div className="flex gap-1">
            <div className="h-8 w-8 rounded bg-gray-100" />
            <div className="h-8 w-8 rounded bg-gray-100" />
            <div className="h-8 w-8 rounded bg-gray-100" />
          </div>
        </div>
      ))}
    </div>
  )
}
import { Header } from '@/components/layout/header'
import { SequenceEditor } from '@/components/automations/sequence-editor'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { AutomationSequence } from '@/types'

const TRIGGER_LABELS: Record<string, string> = {
  new_lead:               'New Lead',
  stage_changed:          'Stage Changed',
  no_show:                'No-Show',
  old_lead_reactivation:  'Old Lead Reactivation',
  consultation_booked:    'Consultation Booked',
  consultation_completed: 'Consultation Completed',
}

export default function AutomationsPage() {
  const [sequences, setSequences] = useState<AutomationSequence[]>([])
  const [loading, setLoading]     = useState(true)
  const [editing, setEditing]     = useState<AutomationSequence | null>(null)
  const [isNew, setIsNew]         = useState(false)
  const [error, setError]         = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/automations')
      const json = await res.json()
      setSequences(json.sequences ?? [])
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  function openNew() { setEditing(null); setIsNew(true) }
  function openEdit(seq: AutomationSequence) { setEditing(seq); setIsNew(false) }
  function closeEditor() { setEditing(null); setIsNew(false) }

  async function handleSave(data: any) {
    if (isNew) {
      const res = await fetch('/api/automations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) { const j = await res.json(); throw new Error(j.error ?? 'Failed to save') }
    } else if (editing) {
      const res = await fetch(`/api/automations/${editing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) { const j = await res.json(); throw new Error(j.error ?? 'Failed to save') }
    }
    closeEditor()
    load()
  }

  async function toggleActive(seq: AutomationSequence) {
    try {
      const res = await fetch(`/api/automations/${seq.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !seq.is_active }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? `HTTP ${res.status}`)
      }
      load()
    } catch (err: any) {
      setError(err.message ?? 'Failed to update sequence')
    }
  }

  async function deleteSequence(id: string) {
    if (!confirm('Delete this sequence? This cannot be undone.')) return
    try {
      const res = await fetch(`/api/automations/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? `HTTP ${res.status}`)
      }
      load()
    } catch (err: any) {
      setError(err.message ?? 'Failed to delete sequence')
    }
  }

  // ── Editor view ──────────────────────────────────────────────
  if (isNew || editing) {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        <Header
          title={isNew ? 'New Sequence' : 'Edit Sequence'}
          subtitle="Configure trigger and message steps"
        />
        <div className="flex-1 overflow-y-auto p-6 max-w-2xl">
          <SequenceEditor
            sequence={editing ?? undefined}
            onSave={handleSave}
            onCancel={closeEditor}
          />
        </div>
      </div>
    )
  }

  // ── List view ─────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header
        title="Automations"
        subtitle="Email and SMS follow-up sequences"
        actions={
          <Button size="sm" onClick={openNew}>
            <Plus className="h-4 w-4" />
            New Sequence
          </Button>
        }
      />

      <div className="flex-1 overflow-y-auto p-6">
        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        {loading ? (
          <AutomationsSkeleton />
        ) : sequences.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-50">
              <Zap className="h-6 w-6 text-indigo-600" />
            </div>
            <h2 className="text-base font-semibold text-gray-900">No sequences yet</h2>
            <p className="text-sm text-gray-500 max-w-sm">
              Create your first automation to automatically follow up with leads.
            </p>
            <Button size="sm" onClick={openNew}>
              <Plus className="h-4 w-4" />
              New Sequence
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {sequences.map((seq) => (
              <div
                key={seq.id}
                className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-4 py-3 hover:shadow-sm transition-all"
              >
                <div className="flex items-center gap-3">
                  <div className={`h-2.5 w-2.5 rounded-full ${seq.is_active ? 'bg-emerald-500' : 'bg-gray-300'}`} />
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{seq.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Badge variant="secondary" className="text-xs">
                        {TRIGGER_LABELS[seq.trigger_type] ?? seq.trigger_type}
                      </Badge>
                      <span className="text-xs text-gray-400">
                        {(seq.steps ?? []).length} step{(seq.steps ?? []).length !== 1 ? 's' : ''}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-gray-400 hover:text-gray-700"
                    title={seq.is_active ? 'Deactivate' : 'Activate'}
                    onClick={() => toggleActive(seq)}
                  >
                    {seq.is_active
                      ? <ToggleRight className="h-4 w-4 text-emerald-500" />
                      : <ToggleLeft className="h-4 w-4" />
                    }
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-gray-400 hover:text-gray-700"
                    onClick={() => openEdit(seq)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-gray-400 hover:text-red-500"
                    onClick={() => deleteSequence(seq.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
