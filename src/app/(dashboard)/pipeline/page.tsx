'use client'
import { useCallback, useEffect, useState } from 'react'
import { Header } from '@/components/layout/header'
import { PipelineBoard } from '@/components/pipeline/pipeline-board'
import { createClient } from '@/lib/supabase/client'
import type { PipelineColumn } from '@/types'

export default function PipelinePage() {
  const [columns, setColumns] = useState<PipelineColumn[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const supabase = createClient()

      const [{ data: stages }, { data: contacts }] = await Promise.all([
        supabase.from('pipeline_stages').select('*').order('position'),
        supabase
          .from('contacts')
          .select('*, stage:pipeline_stages(*)')
          .eq('is_archived', false)
          .not('stage_id', 'is', null),
      ])

      const cols: PipelineColumn[] = (stages ?? []).map((stage) => {
        const stageContacts = (contacts ?? []).filter((c: any) => c.stage_id === stage.id)
        return { stage, contacts: stageContacts, count: stageContacts.length }
      })

      setColumns(cols)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleStageChange(contactId: string, stageId: string) {
    const supabase = createClient()
    await supabase.from('contacts').update({ stage_id: stageId }).eq('id', contactId)
    load()
  }

  const totalLeads = columns.reduce((sum, c) => sum + c.count, 0)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header
        title="Pipeline"
        subtitle={`${totalLeads} active contacts`}
      />

      <div className="flex-1 overflow-hidden p-6">
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
