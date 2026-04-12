'use client'
import { useCallback, useEffect, useState } from 'react'
import { Header } from '@/components/layout/header'
import { PipelineBoard } from '@/components/pipeline/pipeline-board'
import { createClient } from '@/lib/supabase/client'
import type { PipelineColumn } from '@/types'

export default function PipelinePage() {
  const [columns, setColumns] = useState<PipelineColumn[]>([])
  const [loading, setLoading] = useState(true)
  const [moveError, setMoveError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const supabase = createClient()

      const [{ data: stages }, contactsRes] = await Promise.all([
        supabase.from('pipeline_stages').select('*').order('position'),
        fetch('/api/leads'),
      ])

      const contacts = contactsRes.ok ? await contactsRes.json() : []
      const staged = (contacts as any[]).filter((c) => c.stage_id != null)

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
          <div className="flex items-center justify-center h-full">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
          </div>
        ) : (
          <PipelineBoard columns={columns} onStageChange={handleStageChange} />
        )}
      </div>
    </div>
  )
}
