'use client'
import { useCallback, useEffect, useState } from 'react'
import { Header } from '@/components/layout/header'
import { PipelineBoard } from '@/components/pipeline/pipeline-board'
import { createClient } from '@/lib/supabase/client'
import type { PipelineColumn, PipelineContact } from '@/types'

function PipelineSkeleton() {
  return (
    <div className="flex h-full gap-4 animate-pulse overflow-hidden">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex w-64 flex-none flex-col rounded-xl border border-gray-200 bg-gray-50">
          <div className="flex items-center gap-2 border-b border-gray-200 px-3 py-2.5">
            <div className="h-2.5 w-2.5 rounded-full bg-gray-300" />
            <div className="h-3.5 w-24 rounded bg-gray-200" />
          </div>
          <div className="space-y-2 p-2">
            {[0, 1].map((j) => (
              <div key={j} className="space-y-2 rounded-lg border border-gray-200 bg-white p-3">
                <div className="h-3.5 w-28 rounded bg-gray-200" />
                <div className="h-3 w-36 rounded bg-gray-100" />
                <div className="h-3 w-20 rounded bg-gray-100" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export default function PipelinePage() {
  const [columns, setColumns] = useState<PipelineColumn[]>([])
  const [loading, setLoading] = useState(true)
  const [moveError, setMoveError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const supabase = createClient()

      const [{ data: stages }, { data: contactsData }] = await Promise.all([
        supabase.from('pipeline_stages').select('*').order('position'),
        supabase
          .from('contacts_active')
          .select('id, first_name, last_name, email, phone, procedure_interest, last_activity_at, stage_id')
          .eq('is_archived', false)
          .order('last_activity_at', { ascending: false }),
      ])

      const contacts = contactsData ?? []
      const staged = contacts.filter((c) => c.stage_id != null) as PipelineContact[]

      const cols: PipelineColumn[] = (stages ?? []).map((stage) => {
        const stageContacts = staged.filter((c) => c.stage_id === stage.id)
        return { stage, contacts: stageContacts, count: stageContacts.length }
      })

      setColumns(cols)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleStageChange(contactId: string, stageId: string) {
    setMoveError(null)
    const previousColumns = columns

    // Optimistic update: move the card visually before the API call. Without
    // this, the card sits in its old column for the duration of the round-
    // trip + reload, which feels broken during a demo. On failure we restore
    // previousColumns and show the error.
    setColumns((cols) => {
      let moved: typeof cols[number]['contacts'][number] | null = null
      const next = cols.map((col) => {
        if (col.contacts.some((c) => c.id === contactId)) {
          moved = col.contacts.find((c) => c.id === contactId) ?? null
          return {
            ...col,
            contacts: col.contacts.filter((c) => c.id !== contactId),
            count: col.count - 1,
          }
        }
        return col
      })
      if (!moved) return cols
      return next.map((col) =>
        col.stage.id === stageId
          ? { ...col, contacts: [{ ...(moved as any), stage_id: stageId }, ...col.contacts], count: col.count + 1 }
          : col
      )
    })

    try {
      const res = await fetch(`/api/contacts/${contactId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage_id: stageId }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      // Server accepted — keep the optimistic state. We do NOT call load()
      // here because it'd cause a visible flash; the next focus/visibility
      // change or manual refresh will pick up any server-side drift.
    } catch (err: any) {
      setColumns(previousColumns)
      setMoveError(err.message ?? 'Failed to move contact')
    }
  }

  const totalLeads = columns.reduce((sum, c) => sum + c.count, 0)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header
        title="Pipeline"
        subtitle={`${totalLeads} active contacts`}
      />

      <div className="flex-1 overflow-hidden p-6">
        {moveError && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
            <p className="text-sm text-red-700">{moveError}</p>
          </div>
        )}
        {loading ? (
          <PipelineSkeleton />
        ) : (
          <PipelineBoard columns={columns} onStageChange={handleStageChange} />
        )}
      </div>
    </div>
  )
}
