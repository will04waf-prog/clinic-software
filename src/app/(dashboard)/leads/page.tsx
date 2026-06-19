'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Header } from '@/components/layout/header'
import { LeadsTable } from '@/components/leads/leads-table'
import { AddLeadDialog } from '@/components/leads/add-lead-dialog'
import type { Contact } from '@/types'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

const POLL_INTERVAL_MS = 12_000

function contactsSignature(rows: Contact[]): string {
  return rows
    .map((c) => `${c.id}:${c.has_unread ? 1 : 0}:${c.last_activity_at ?? ''}:${c.status}:${c.is_archived ? 1 : 0}`)
    .join('|')
}

function LeadsSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white animate-pulse">
      <div className="border-b border-gray-100 bg-gray-50 px-4 py-3">
        <div className="h-3 w-48 rounded bg-gray-200" />
      </div>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-4 border-b border-gray-100 px-4 py-3 last:border-0">
          <div className="flex-1 space-y-1.5">
            <div className="h-3.5 w-36 rounded bg-gray-200" />
            <div className="h-3 w-48 rounded bg-gray-100" />
          </div>
          <div className="h-5 w-16 rounded-full bg-gray-200" />
          <div className="h-5 w-14 rounded-full bg-gray-200" />
          <div className="h-7 w-7 rounded bg-gray-100" />
        </div>
      ))}
    </div>
  )
}

type Tab = 'all' | 'leads' | 'patients' | 'inactive'

export default function LeadsPage() {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('all')

  // Holds the signature of the last applied contacts array, so a
  // background poll that returns identical data can skip setContacts
  // and avoid an unnecessary re-render.
  const signatureRef = useRef<string>('')

  // `silent: true` means a background poll: don't toggle loading and
  // skip the setState if nothing the UI cares about changed.
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    if (!silent) setError(null)
    try {
      const res = await fetch('/api/leads')
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      const data: Contact[] = await res.json()
      const sig = contactsSignature(data)
      if (silent && sig === signatureRef.current) return
      signatureRef.current = sig
      setContacts(data)
    } catch (err: any) {
      console.error('[leads] load error:', err)
      if (!silent) setError(err.message ?? 'Failed to load contacts')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Poll every 12s for new inbound messages so the unread indicator
  // updates without a manual refresh. Pause while the tab is hidden
  // (no point polling when the user isn't looking) and fire an
  // immediate refresh on re-show so the list is fresh when they
  // come back.
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null

    const start = () => {
      if (intervalId !== null) return
      intervalId = setInterval(() => load(true), POLL_INTERVAL_MS)
    }
    const stop = () => {
      if (intervalId === null) return
      clearInterval(intervalId)
      intervalId = null
    }

    const onVisibilityChange = () => {
      if (document.hidden) {
        stop()
      } else {
        load(true)
        start()
      }
    }

    if (!document.hidden) start()
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [load])

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
        actions={<AddLeadDialog onSuccess={() => load()} />}
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {/* Tab bar — controls filter only, no TabsContent wrapping */}
        <div className="overflow-x-auto">
          <Tabs value={tab} onValueChange={(v) => { setTab(v as Tab); setSearch('') }}>
            <TabsList>
              <TabsTrigger value="all">All ({counts.all})</TabsTrigger>
              <TabsTrigger value="leads">Leads ({counts.leads})</TabsTrigger>
              <TabsTrigger value="patients">Patients ({counts.patients})</TabsTrigger>
              <TabsTrigger value="inactive">Inactive ({counts.inactive})</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* Content rendered directly — avoids Radix TabsContent hidden-state bug */}
        {loading && <LeadsSkeleton />}

        {!loading && error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
            <p className="text-sm font-medium text-red-700">Failed to load contacts</p>
            <p className="text-xs text-red-500 mt-0.5">{error}</p>
          </div>
        )}

        {!loading && !error && (
          <LeadsTable
            contacts={filtered}
            onRefresh={() => load()}
            search={search}
            onSearchChange={setSearch}
            totalForTab={tabFiltered.length}
          />
        )}
      </div>
    </div>
  )
}
