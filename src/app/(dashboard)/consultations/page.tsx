'use client'
import { useCallback, useEffect, useState } from 'react'
import { Header } from '@/components/layout/header'
import { ConsultationList } from '@/components/consultations/consultation-list'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { createClient } from '@/lib/supabase/client'
import type { Consultation } from '@/types'

export default function ConsultationsPage() {
  const [consultations, setConsultations] = useState<Consultation[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('upcoming')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const supabase = createClient()
      const { data } = await supabase
        .from('consultations')
        .select(`
          *,
          contact:contacts(id, first_name, last_name, email, phone),
          assignee:profiles(full_name)
        `)
        .order('scheduled_at', { ascending: true })

      setConsultations(data ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const now = new Date()
  const todayStr = now.toDateString()

  const upcoming = consultations.filter(
    (c) =>
      new Date(c.scheduled_at) >= now &&
      (c.status === 'scheduled' || c.status === 'confirmed')
  )

  const today = consultations.filter(
    (c) => new Date(c.scheduled_at).toDateString() === todayStr
  )

  const noShows = consultations.filter((c) => c.status === 'no_show')

  const completed = consultations.filter((c) => c.status === 'completed')

  function getList(): Consultation[] {
    switch (tab) {
      case 'today':     return today
      case 'no_shows':  return noShows
      case 'completed': return completed
      default:          return upcoming
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header
        title="Consultations"
        subtitle={`${upcoming.length} upcoming · ${today.length} today`}
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="upcoming">
              Upcoming ({upcoming.length})
            </TabsTrigger>
            <TabsTrigger value="today">
              Today ({today.length})
            </TabsTrigger>
            <TabsTrigger value="no_shows">
              No-Shows ({noShows.length})
            </TabsTrigger>
            <TabsTrigger value="completed">
              Completed ({completed.length})
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="mt-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
            </div>
          ) : (
            <ConsultationList consultations={getList()} onRefresh={load} />
          )}
        </div>
      </div>
    </div>
  )
}
