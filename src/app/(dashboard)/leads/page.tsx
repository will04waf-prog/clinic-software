'use client'
import { useCallback, useEffect, useState } from 'react'
import { Header } from '@/components/layout/header'
import { LeadsTable } from '@/components/leads/leads-table'
import { AddLeadDialog } from '@/components/leads/add-lead-dialog'
import { createClient } from '@/lib/supabase/client'
import type { Contact, PipelineStage } from '@/types'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

type Tab = 'all' | 'leads' | 'patients' | 'inactive'

export default function LeadsPage() {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [stages, setStages] = useState<PipelineStage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('all')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const supabase = createClient()
      const [{ data: contactsData, error: contactsError }, { data: stagesData, error: stagesError }] =
        await Promise.all([
          supabase
            .from('contacts')
            .select('*, stage:pipeline_stages(*), tags:contact_tags(tag:tags(*))')
            .eq('is_archived', false)
            .order('last_activity_at', { ascending: false }),
          supabase
            .from('pipeline_stages')
            .select('*')
            .order('position'),
        ])

      if (contactsError) throw new Error(contactsError.message)
      if (stagesError)   throw new Error(stagesError.message)

      setContacts(
        (contactsData ?? []).map((c: any) => ({
          ...c,
          tags: (c.tags ?? []).map((t: any) => t.tag).filter(Boolean),
        }))
      )
      setStages(stagesData ?? [])
    } catch (err: any) {
      console.error('[leads] load error:', err)
      setError(err.message ?? 'Failed to load contacts')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = contacts.filter((c) =>
    tab === 'all' ? true : c.status === tab
  )

  const counts = {
    all:      contacts.length,
    leads:    contacts.filter(c => c.status === 'lead').length,
    patients: contacts.filter(c => c.status === 'patient').length,
    inactive: contacts.filter(c => c.status === 'inactive').length,
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header
        title="Leads & Contacts"
        subtitle={`${contacts.length} total contacts`}
        actions={<AddLeadDialog onSuccess={load} />}
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {/* Tab bar — controls filter only, no TabsContent wrapping */}
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
          <TabsList>
            <TabsTrigger value="all">All ({counts.all})</TabsTrigger>
            <TabsTrigger value="leads">Leads ({counts.leads})</TabsTrigger>
            <TabsTrigger value="patients">Patients ({counts.patients})</TabsTrigger>
            <TabsTrigger value="inactive">Inactive ({counts.inactive})</TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Content rendered directly — avoids Radix TabsContent hidden-state bug */}
        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
          </div>
        )}

        {!loading && error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
            <p className="text-sm font-medium text-red-700">Failed to load contacts</p>
            <p className="text-xs text-red-500 mt-0.5">{error}</p>
          </div>
        )}

        {!loading && !error && (
          <LeadsTable contacts={filtered} stages={stages} onRefresh={load} />
        )}
      </div>
    </div>
  )
}
