'use client'
import { useCallback, useEffect, useState } from 'react'
import { Header } from '@/components/layout/header'
import { PipelineBoard } from '@/components/pipeline/pipeline-board'
import { createClient } from '@/lib/supabase/client'
import type { PipelineColumn } from '@/types'

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
          .from('contacts')
          .select('id, first_name, last_name, email, phone, procedure_interest, last_activity_at, stage_id')
          .eq('is_archived', false)
          .order('last_activity_at', { ascending: false }),
      ])

      const contacts = contactsData ?? []
      const staged = contacts.filter((c) => c.stage_id != null)

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
      load()
    } catch (err: any) {
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
