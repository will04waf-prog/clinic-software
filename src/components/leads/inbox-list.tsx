'use client'
import { useState } from 'react'
import Link from 'next/link'
import { MoreHorizontal, Search, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { formatRelative, formatProcedure } from '@/lib/utils'
import { ContactAvatar } from '@/components/leads/contact-avatar'
import { SourcePill } from '@/components/leads/source-pill'
import type { Contact } from '@/types'
import { cn } from '@/lib/utils'

interface InboxListProps {
  contacts: Contact[]
  selectedId: string | null
  onSelect: (id: string) => void
  search: string
  onSearchChange: (v: string) => void
  onArchived: () => void
  filterChips: React.ReactNode
}

/**
 * Inbox column. Click a row to select it inline; the conversation pane
 * to the right of this component reads `selectedId` from the URL.
 * Matches the mockup: search at the top inside the panel card, filter
 * chips beside the "Inbox N new" heading, scrollable row list below.
 *
 * Rows show: avatar, name + time (right), procedure + source pill,
 * preview line + unread pill (right).
 */
export function InboxList({
  contacts,
  selectedId,
  onSelect,
  search,
  onSearchChange,
  onArchived,
  filterChips,
}: InboxListProps) {
  const [archivingId, setArchivingId] = useState<string | null>(null)

  async function archiveContact(id: string) {
    if (!window.confirm('Archive this contact? You can restore them from settings.')) return
    setArchivingId(id)
    try {
      const res = await fetch(`/api/contacts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_archived: true }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      onArchived()
    } catch (err) {
      console.error('[inbox-list] archive failed:', err)
    } finally {
      setArchivingId(null)
    }
  }

  const unreadTotal  = contacts.filter(c => c.has_unread).length
  const aiReadyTotal = contacts.filter(c => c.has_pending_draft).length

  // One chip total. When both counts are non-zero we collapse to a
  // single "N new · M AI ready" line so the header doesn't grow a
  // second pill on busy days. Empty state is empty — no zero pills.
  let headerChip: string | null = null
  if (unreadTotal > 0 && aiReadyTotal > 0) {
    headerChip = `${unreadTotal} new · ${aiReadyTotal} AI ready`
  } else if (unreadTotal > 0) {
    headerChip = `${unreadTotal} new`
  } else if (aiReadyTotal > 0) {
    headerChip = `${aiReadyTotal} AI ready`
  }

  return (
    <div className="flex h-full flex-col overflow-hidden border-r border-[#0B2027]/8 bg-white">
      {/* Header: "Inbox N new" + filter chips */}
      <div className="border-b border-[#0B2027]/8 px-4 pt-4 pb-3 space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-[15px] font-semibold text-[#0B2027]">Inbox</h2>
          {headerChip && (
            <span className="inline-flex items-center rounded-full bg-[#02C39A]/15 px-2 py-0.5 text-[11px] font-semibold text-[#028090]">
              {headerChip}
            </span>
          )}
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#0B2027]/40" />
          <Input
            className="h-9 rounded-lg border-[#0B2027]/10 bg-[#FAF6EC]/55 pl-9 text-sm placeholder:text-[#0B2027]/40 focus-visible:ring-[#02C39A]/40"
            placeholder="Search leads or procedures"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
        {filterChips}
      </div>

      {/* Rows */}
      <ul className="flex-1 overflow-y-auto">
        {contacts.length === 0 && (
          <li className="px-5 py-10 text-center text-sm text-[#0B2027]/45">
            No conversations.
          </li>
        )}
        {contacts.map((contact) => {
          const name = `${contact.first_name ?? ''} ${contact.last_name ?? ''}`.trim() || 'Unknown'
          const procedures = Array.from(new Set(contact.procedure_interest ?? []))
          const firstProcedure = procedures[0]
          const time = contact.last_activity_at ? formatRelative(contact.last_activity_at) : ''
          const selected = contact.id === selectedId
          return (
            <li key={contact.id} className="group relative">
              <button
                type="button"
                onClick={() => onSelect(contact.id)}
                className={cn(
                  'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors',
                  selected
                    ? 'bg-[#FAF6EC]/70'
                    : 'hover:bg-[#FAF6EC]/40',
                )}
                aria-pressed={selected}
              >
                <ContactAvatar firstName={contact.first_name} lastName={contact.last_name} size="md" />

                <div className="min-w-0 flex-1">
                  {/* Top row — name + sparkle + time */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <p
                        className={cn(
                          'truncate text-[14px] leading-tight text-[#0B2027]',
                          contact.has_unread ? 'font-semibold' : 'font-medium',
                        )}
                      >
                        {name}
                      </p>
                      {contact.has_pending_draft && (
                        <Sparkles
                          aria-label="AI draft ready"
                          className="h-3.5 w-3.5 shrink-0 text-[#02C39A] [animation:twin-pulse_2.4s_ease-in-out_infinite]"
                          fill="currentColor"
                        />
                      )}
                    </div>
                    {time && (
                      <span className="shrink-0 text-[11px] text-[#0B2027]/45">
                        {time}
                      </span>
                    )}
                  </div>

                  {/* Procedure + source */}
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                    {firstProcedure && (
                      <span className="text-[12px] font-medium text-[#028090]">
                        {formatProcedure(firstProcedure)}
                      </span>
                    )}
                    {firstProcedure && contact.source && (
                      <span className="text-[#0B2027]/25" aria-hidden="true">·</span>
                    )}
                    <SourcePill source={contact.source} />
                  </div>

                  {/* Preview + unread chip */}
                  <div className="mt-1 flex items-center justify-between gap-3">
                    <p
                      className={cn(
                        'truncate text-[12.5px]',
                        contact.has_unread ? 'text-[#0B2027]/85' : 'text-[#0B2027]/55',
                      )}
                    >
                      {contact.email ?? (contact.phone ?? '—')}
                    </p>
                    {contact.has_unread && (
                      <span
                        className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-[#02C39A] px-1.5 text-[10px] font-semibold text-white"
                        aria-label="Unread"
                      >
                        1
                      </span>
                    )}
                  </div>
                </div>
              </button>

              {/* Per-row actions menu — absolute overlay, only on hover. */}
              <div className="absolute right-2 top-2 z-10 opacity-0 transition-opacity group-hover:opacity-100">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7 hover:bg-[#0B2027]/5">
                      <MoreHorizontal className="h-4 w-4 text-[#0B2027]/60" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem asChild>
                      <Link href={`/leads/${contact.id}`}>View profile</Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => archiveContact(contact.id)}
                      className="text-red-600"
                      disabled={archivingId === contact.id}
                    >
                      {archivingId === contact.id ? 'Archiving…' : 'Archive'}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
