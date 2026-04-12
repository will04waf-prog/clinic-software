'use client'
import { useCallback, useEffect, useState } from 'react'
import { Header } from '@/components/layout/header'
import { LeadsTable } from '@/components/leads/leads-table'
import { AddLeadDialog } from '@/components/leads/add-lead-dialog'
import type { Contact } from '@/types'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

type Tab = 'all' | 'leads' | 'patients' | 'inactive'

export default function LeadsPage() {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('all')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/leads')
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      const data = await res.json()
      setContacts(data)
    } catch (err: any) {
      console.error('[leads] load error:', err)
      setError(err.message ?? 'Failed to load contacts')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const [search, setSearch] = useState('')

  // Map plural tab keys to singular status values
  const TAB_STATUS: Record<Tab, string | null> = {
    all:      null,
    leads:    'lead',
    patients: 'patient',
    inactive: 'inactive',
  }

  const tabFiltered = TAB_STATUS[tab] === null
    ? contacts
    : contacts.filter((c) => c.status === TAB_STATUS[tab])

  const q = search.toLowerCase().trim()
  const filtered = q === ''
    ? tabFiltered
    : tabFiltered.filter((c) => {
        const first    = (c.first_name  ?? '').toLowerCase()
        const last     = (c.last_name   ?? '').toLowerCase()
        const email    = (c.email       ?? '').toLowerCase()
        const phone    = (c.phone       ?? '').replace(/\D/g, '')
        const fullName = `${first} ${last}`.trim()
        const qPhone   = q.replace(/\D/g, '')
        return (
          fullName.includes(q) ||
          first.includes(q) ||
          last.includes(q) ||
          email.includes(q) ||
          (qPhone.length > 0 && phone.includes(qPhone))
        )
      })

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
        <Tabs value={tab} onValueChange={(v) => { setTab(v as Tab); setSearch('') }}>
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
          <LeadsTable
            contacts={filtered}
            onRefresh={load}
            search={search}
            onSearchChange={setSearch}
            totalForTab={tabFiltered.length}
          />
        )}
      </div>
    </div>
  )
}
