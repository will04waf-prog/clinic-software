'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { Header } from '@/components/layout/header'
import { AddLeadDialog } from '@/components/leads/add-lead-dialog'
import { TimeToFirstContactCard } from '@/components/leads/time-to-first-contact-card'
import { InboxFilterChips, type InboxFilter } from '@/components/leads/inbox-filter-chips'
import { InboxList } from '@/components/leads/inbox-list'
import { ConversationPane } from '@/components/leads/conversation-pane'
import type { Contact } from '@/types'

// Bumped from 6s → 20s. The leads list still refreshes on tab focus
// and visibilitychange, so the user-perceived freshness on the
// "tab back to dashboard" demo path is unchanged; this just cuts
// background polling cost by 3.3×.
const POLL_INTERVAL_MS = 20_000

function contactsSignature(rows: Contact[]): string {
  return rows
    .map((c) => `${c.id}:${c.has_unread ? 1 : 0}:${c.last_activity_at ?? ''}:${c.status}:${c.is_archived ? 1 : 0}`)
    .join('|')
}

function InboxSkeleton() {
  return (
    <div className="grid h-full grid-cols-[360px_1fr] overflow-hidden border-t border-[#0B2027]/8 bg-white">
      <div className="animate-pulse border-r border-[#0B2027]/8 p-4 space-y-3">
        <div className="h-4 w-24 rounded bg-[#0B2027]/10" />
        <div className="h-9 rounded-lg bg-[#0B2027]/5" />
        <div className="space-y-2 pt-2">
          {[0,1,2,3,4].map(i => (
            <div key={i} className="flex items-start gap-3 py-2">
              <div className="h-10 w-10 rounded-full bg-[#0B2027]/10" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3.5 w-32 rounded bg-[#0B2027]/10" />
                <div className="h-3 w-44 rounded bg-[#0B2027]/5" />
                <div className="h-3 w-40 rounded bg-[#0B2027]/5" />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="animate-pulse bg-[#FAF6EC]/45" />
    </div>
  )
}

/**
 * Inbox-style leads page. Two-column layout: a conversation list on the
 * left, the open conversation on the right.
 *
 * Selection is URL-driven (`?c=<contactId>`) so conversations are
 * bookmarkable/shareable. On first load with no `?c`, auto-selects the
 * most recent unread (falling back to the most recent contact overall).
 *
 * The list-fetch + polling pattern is preserved from the previous
 * iteration. Conversation messages are fetched separately by the
 * ConversationPane component via the new
 * `/api/contacts/[id]/messages` endpoint.
 *
 * The original /leads/[id] deep profile page is unchanged — kebab →
 * "View profile" deep-links there for the full record view.
 */
export default function LeadsInboxPage() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const selectedId = searchParams.get('c')

  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<InboxFilter>('all')
  const [search, setSearch] = useState('')
  const signatureRef = useRef<string>('')
  const autoSelectedRef = useRef(false)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    if (!silent) setError(null)
    try {
      const res = await fetch('/api/leads', { cache: 'no-store' })
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

  // Poll the list. Same visibility/focus pattern as before.
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
    const onVis = () => { if (document.hidden) stop(); else { load(true); start() } }
    const onFocus = () => load(true)
    if (!document.hidden) start()
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', onFocus)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('focus', onFocus)
    }
  }, [load])

  // Filter + search the in-memory list (server returns all contacts,
  // same as before).
  const filteredContacts = useMemo(() => {
    let rows = contacts
    if (filter === 'unread') rows = rows.filter(c => c.has_unread)
    if (filter === 'booked') rows = rows.filter(c => c.status === 'patient')
    const q = search.toLowerCase().trim()
    if (q) {
      const qDigits = q.replace(/\D/g, '')
      rows = rows.filter(c => {
        const first = (c.first_name ?? '').toLowerCase()
        const last  = (c.last_name ?? '').toLowerCase()
        const email = (c.email ?? '').toLowerCase()
        const phone = (c.phone ?? '').replace(/\D/g, '')
        const proc  = (c.procedure_interest ?? []).join(' ').toLowerCase()
        return (
          `${first} ${last}`.includes(q) ||
          first.includes(q) ||
          last.includes(q) ||
          email.includes(q) ||
          proc.includes(q) ||
          (qDigits.length > 0 && phone.includes(qDigits))
        )
      })
    }
    return rows
  }, [contacts, filter, search])

  // First-load auto-select: most recent unread, fall back to most
  // recent. Runs once after the initial list loads. If the user has
  // ?c=<id> in the URL we leave it alone.
  useEffect(() => {
    if (autoSelectedRef.current) return
    if (loading) return
    if (selectedId) { autoSelectedRef.current = true; return }
    if (contacts.length === 0) return
    const target = contacts.find(c => c.has_unread) ?? contacts[0]
    if (target) {
      const params = new URLSearchParams(searchParams.toString())
      params.set('c', target.id)
      router.replace(`${pathname}?${params.toString()}`, { scroll: false })
    }
    autoSelectedRef.current = true
  }, [loading, contacts, selectedId, router, pathname, searchParams])

  const selectedContact = useMemo(
    () => contacts.find(c => c.id === selectedId) ?? null,
    [contacts, selectedId],
  )

  function selectContact(id: string) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('c', id)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  const unreadTotal = useMemo(() => contacts.filter(c => c.has_unread).length, [contacts])
  const bookedTotal = useMemo(() => contacts.filter(c => c.status === 'patient').length, [contacts])

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <Header
        title="Inbox"
        subtitle={`${contacts.length} total contacts`}
        actions={<AddLeadDialog onSuccess={() => load()} />}
      />

      <div className="flex-1 overflow-hidden flex flex-col p-6 pt-4 gap-4">
        {/* Stat strip — visual placeholder, no real calc yet. */}
        <TimeToFirstContactCard />

        {/* Two-pane inbox. Min-h-0 + h-full so each pane scrolls
            internally instead of pushing the page. */}
        {loading && contacts.length === 0 ? (
          <div className="flex-1 min-h-0 overflow-hidden rounded-xl border border-[#0B2027]/8">
            <InboxSkeleton />
          </div>
        ) : error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
            <p className="text-sm font-medium text-red-700">Failed to load contacts</p>
            <p className="text-xs text-red-500 mt-0.5">{error}</p>
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-hidden rounded-xl border border-[#0B2027]/8 bg-white shadow-[0_1px_2px_rgba(11,32,39,0.04)]">
            <div className="grid h-full grid-cols-[360px_1fr] overflow-hidden">
              <InboxList
                contacts={filteredContacts}
                selectedId={selectedId}
                onSelect={selectContact}
                search={search}
                onSearchChange={setSearch}
                onArchived={() => load()}
                filterChips={
                  <InboxFilterChips
                    value={filter}
                    onChange={setFilter}
                    unreadCount={unreadTotal}
                    bookedCount={bookedTotal}
                  />
                }
              />
              <ConversationPane
                contact={selectedContact}
                onArchived={() => load()}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
