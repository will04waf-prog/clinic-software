'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Phone, MoreHorizontal, CheckCheck, Zap, MessagesSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ContactAvatar } from '@/components/leads/contact-avatar'
import { SourcePill } from '@/components/leads/source-pill'
import { InlineComposer } from '@/components/leads/inline-composer'
import { BookConsultationDialog } from '@/components/consultations/book-consultation-dialog'
import { formatProcedure, formatDate, formatRelative } from '@/lib/utils'
import type { Contact } from '@/types'
import { cn } from '@/lib/utils'

interface Message {
  id: string
  channel: 'sms' | 'email'
  direction: 'inbound' | 'outbound'
  status: string
  subject: string | null
  body: string
  sequence_step_id: string | null
  sent_at: string | null
  created_at: string
}

interface ConversationPaneProps {
  contact: Contact | null
  onArchived: () => void
}

// Bumped from 6s → 15s. Refreshes immediately on send + tab focus,
// so live conversation feel is preserved with less background load.
const POLL_INTERVAL_MS = 15_000

// AI Twin: within this window after a fresh inbound, poll the
// pending-draft endpoint aggressively so the indicator → real
// draft hand-off feels instant. The window is bounded so we never
// pile up timers on quiet threads.
const DRAFT_WAIT_WINDOW_MS = 30_000
const DRAFT_WAIT_POLL_MS   = 2_000

/**
 * Right-pane conversation view for the inbox. Loads messages for the
 * selected contact and polls for new ones. Visual treatment matches
 * the Lead Inbox mockup:
 *   - Header: avatar + name + procedure + source + "+ New lead" chip
 *     on the left; phone icon, Book consult button, kebab on the right.
 *   - Cream-tinted scroll area with a centered "Lead captured" divider
 *     at the top and message bubbles below.
 *   - Outbound bubbles: navy #0B2027 with cream text, right-aligned,
 *     bottom-right corner squared. Read-receipt + Auto-reply chip in
 *     the meta row.
 *   - Inbound bubbles: white with a faint border, dark text,
 *     left-aligned with the contact's avatar to the left, bottom-left
 *     corner squared.
 *   - Composer pinned at the bottom: paperclip + input + emoji + AI
 *     Draft button + circular send arrow. The AI Draft button opens
 *     the existing SendSmsDialog, which already wires AI drafting.
 */
interface PendingDraft {
  id: string
  draft_body: string
  draft_subject: string | null
  channel: 'sms' | 'email'
  model: string
  trigger_message_id: string | null
  generated_at: string
}

export function ConversationPane({ contact, onArchived }: ConversationPaneProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [pendingDraft, setPendingDraft] = useState<PendingDraft | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const lastSignatureRef = useRef<string>('')

  const contactId = contact?.id ?? null

  const load = useCallback(async (silent = false) => {
    if (!contactId) return
    if (!silent) setLoading(true)
    if (!silent) setError(null)
    try {
      // Messages and the pending draft are fetched together so the
      // composer pre-fill arrives in the same render tick as the
      // conversation history. The /pending-draft endpoint is cheap
      // (single-row maybeSingle) so paying for it on every poll is
      // fine.
      const [msgRes, draftRes] = await Promise.all([
        fetch(`/api/contacts/${contactId}/messages`, { cache: 'no-store' }),
        fetch(`/api/contacts/${contactId}/pending-draft`, { cache: 'no-store' }),
      ])

      if (!msgRes.ok) {
        const body = await msgRes.json().catch(() => ({}))
        throw new Error(body.error ?? `HTTP ${msgRes.status}`)
      }
      const { messages: data } = (await msgRes.json()) as { messages: Message[] }

      // Signature includes the pending-draft id so a brand-new
      // suggestion arriving while the user is on the thread also
      // triggers a re-render.
      let draftData: PendingDraft | null = null
      if (draftRes.ok) {
        const { draft } = (await draftRes.json()) as { draft: PendingDraft | null }
        draftData = draft
      }

      const sig = data.map(m => `${m.id}:${m.status}`).join('|') + `|d:${draftData?.id ?? '-'}`
      if (silent && sig === lastSignatureRef.current) return
      lastSignatureRef.current = sig
      setMessages(data ?? [])
      setPendingDraft(draftData)
    } catch (err: any) {
      console.error('[conversation-pane] load error:', err)
      if (!silent) setError(err.message ?? 'Failed to load messages')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [contactId])

  // Reset + initial load when the selected contact changes.
  useEffect(() => {
    lastSignatureRef.current = ''
    setPendingDraft(null)
    setMessages([])
    setError(null)
    if (contactId) load()
  }, [contactId, load])

  // Poll while a contact is selected.
  useEffect(() => {
    if (!contactId) return
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
    const onVis = () => {
      if (document.hidden) stop()
      else { load(true); start() }
    }
    const onFocus = () => load(true)

    if (!document.hidden) start()
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', onFocus)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('focus', onFocus)
    }
  }, [contactId, load])

  // ── AI drafting indicator ────────────────────────────────
  // After a fresh inbound lands we expect the auto-draft hook to
  // fire server-side within a couple of seconds. Compute the
  // last-inbound timestamp once and let a small ticker drive the
  // boundary re-render at the 30s edge.
  const lastInbound = messages.length
    ? [...messages].reverse().find(m => m.direction === 'inbound') ?? null
    : null
  const lastInboundAt = lastInbound
    ? new Date(lastInbound.sent_at ?? lastInbound.created_at).getTime()
    : 0
  const [nowTick, setNowTick] = useState(() => Date.now())
  const isDrafting =
    !!lastInbound &&
    !pendingDraft &&
    nowTick - lastInboundAt < DRAFT_WAIT_WINDOW_MS

  // Aggressive 2s poll for the pending-draft only during the
  // window. Uses its own refs so the standard 15s loop above is
  // untouched. Auto-tears-down at the window edge so the inbox
  // doesn't quietly hammer the API forever.
  useEffect(() => {
    if (!contactId)    return
    if (!lastInbound)  return
    if (pendingDraft)  return
    const elapsed = Date.now() - lastInboundAt
    if (elapsed >= DRAFT_WAIT_WINDOW_MS) return

    let intervalId: ReturnType<typeof setInterval> | null = null
    const tick = () => {
      load(true)
      setNowTick(Date.now())
    }
    const start = () => {
      if (intervalId !== null) return
      intervalId = setInterval(tick, DRAFT_WAIT_POLL_MS)
    }
    const stop = () => {
      if (intervalId === null) return
      clearInterval(intervalId)
      intervalId = null
    }

    // Mirror the 15s base poll's visibility behavior: pause the
    // aggressive 2s poll while the tab is hidden, resume + tick once
    // on return. Without this we'd hammer the API every 2s for the
    // whole 30s window while the user is in another tab.
    const onVis = () => { if (document.hidden) stop(); else { tick(); start() } }
    if (!document.hidden) start()
    document.addEventListener('visibilitychange', onVis)

    const remaining = DRAFT_WAIT_WINDOW_MS - elapsed
    const timeoutId = setTimeout(() => {
      stop()
      // One last tick so isDrafting re-evaluates to false cleanly.
      setNowTick(Date.now())
    }, remaining)

    return () => {
      stop()
      clearTimeout(timeoutId)
      document.removeEventListener('visibilitychange', onVis)
    }
    // We key on the inbound id (not the timestamp) so a re-render
    // from the tick itself doesn't restart the interval.
  }, [contactId, lastInbound?.id, !!pendingDraft, lastInboundAt, load])

  // Auto-scroll to bottom when messages change.
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages])

  // ── Empty state ──────────────────────────────────────────
  if (!contact) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-[#FAF6EC]/45 text-center px-6">
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-white shadow-[0_1px_3px_rgba(11,32,39,0.08)]">
          <MessagesSquare className="h-5 w-5 text-[#028090]" />
        </span>
        <p className="mt-4 text-sm font-semibold text-[#0B2027]">No conversation selected</p>
        <p className="mt-1 text-xs text-[#0B2027]/55 max-w-xs">
          Choose a lead from the inbox to see the conversation and reply.
        </p>
      </div>
    )
  }

  const procedures = Array.from(new Set(contact.procedure_interest ?? []))
  const firstProcedure = procedures[0]
  const name = `${contact.first_name ?? ''} ${contact.last_name ?? ''}`.trim() || 'Unknown'
  const isNewLead = contact.status === 'lead'

  // Lead-captured divider source matches the contact's source on the
  // sender's profile, mirroring the mockup's "Lead captured from
  // Instagram DM" header chip.
  const capturedAt = contact.created_at
    ? `${formatDate(contact.created_at)}`
    : 'Today'

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#FAF6EC]/45">
      {/* ── Header ────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 border-b border-[#0B2027]/8 bg-white px-5 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <ContactAvatar firstName={contact.first_name} lastName={contact.last_name} size="md" />
          <div className="min-w-0">
            <Link
              href={`/leads/${contact.id}`}
              className="block truncate text-[15px] font-semibold text-[#0B2027] hover:underline"
            >
              {name}
            </Link>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
              {firstProcedure && (
                <span className="text-[12px] font-medium text-[#028090]">
                  {formatProcedure(firstProcedure)}
                </span>
              )}
              {firstProcedure && contact.source && (
                <span className="text-[#0B2027]/25" aria-hidden="true">·</span>
              )}
              <SourcePill source={contact.source} />
              {isNewLead && (
                <span className="inline-flex items-center gap-1 rounded-full bg-[#02C39A]/15 px-1.5 py-0.5 text-[11px] font-medium text-[#028090]">
                  <span aria-hidden="true">+</span>New lead
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {contact.phone && (
            <a
              href={`tel:${contact.phone}`}
              className="hidden sm:inline-flex h-9 w-9 items-center justify-center rounded-full text-[#0B2027]/60 hover:bg-[#0B2027]/5 hover:text-[#0B2027] transition-colors"
              aria-label="Call"
              title={`Call ${contact.phone}`}
            >
              <Phone className="h-4 w-4" />
            </a>
          )}
          <BookConsultationDialog contactId={contact.id} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-9 w-9 hover:bg-[#0B2027]/5">
                <MoreHorizontal className="h-4 w-4 text-[#0B2027]/60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link href={`/leads/${contact.id}`}>View full profile</Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={async () => {
                  if (!window.confirm('Archive this contact?')) return
                  await fetch(`/api/contacts/${contact.id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ is_archived: true }),
                  })
                  onArchived()
                }}
                className="text-red-600"
              >
                Archive contact
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* ── Messages ─────────────────────────────────────── */}
      <div ref={scrollerRef} className="flex-1 overflow-y-auto px-5 py-6">
        {loading && messages.length === 0 ? (
          <p className="text-center text-sm text-[#0B2027]/45">Loading…</p>
        ) : error ? (
          <p className="text-center text-sm text-red-600">{error}</p>
        ) : (
          <div className="mx-auto max-w-3xl space-y-4">
            {/* Lead-captured system divider */}
            <div className="flex justify-center">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#0B2027]/8 bg-white px-3 py-1 text-[11px] text-[#0B2027]/55 shadow-[0_1px_2px_rgba(11,32,39,0.04)]">
                <SourcePill source={contact.source} showLabel={false} className="!bg-transparent !p-0" />
                Lead captured · {capturedAt}
              </span>
            </div>

            {messages.length === 0 && (
              <p className="py-8 text-center text-sm text-[#0B2027]/45">
                No messages yet. Use AI Draft below to send the first reply.
              </p>
            )}

            {messages.map((m) => {
              const inbound = m.direction === 'inbound'
              const failed  = m.status === 'failed'
              const read    = m.status === 'delivered' || m.status === 'opened'
              const time = m.sent_at ?? m.created_at
              return (
                <div key={m.id} className={cn('flex gap-2', inbound ? 'justify-start' : 'justify-end')}>
                  {inbound && (
                    <ContactAvatar
                      firstName={contact.first_name}
                      lastName={contact.last_name}
                      size="sm"
                      className="mt-auto"
                    />
                  )}
                  <div className={cn('flex max-w-[78%] flex-col', inbound ? 'items-start' : 'items-end')}>
                    <div
                      className={cn(
                        'px-4 py-2.5 text-[13.5px] leading-snug whitespace-pre-line',
                        inbound
                          ? 'rounded-2xl rounded-bl-md bg-white text-[#0B2027] border border-[#0B2027]/8 shadow-[0_1px_2px_rgba(11,32,39,0.04)]'
                          : 'rounded-2xl rounded-br-md bg-[#0B2027] text-[#FAF6EC] shadow-[0_4px_14px_rgba(11,32,39,0.18)]',
                      )}
                    >
                      {m.subject && (
                        <p className={cn(
                          'mb-1 text-[11px] font-semibold uppercase tracking-wide',
                          inbound ? 'text-[#0B2027]/60' : 'text-[#FAF6EC]/65',
                        )}>
                          {m.subject}
                        </p>
                      )}
                      {m.body}
                    </div>
                    <div className={cn(
                      'mt-1 flex items-center gap-1.5 text-[11px]',
                      inbound ? 'text-[#0B2027]/45' : 'text-[#0B2027]/55',
                    )}>
                      <span>{formatRelative(time)}</span>
                      {!inbound && read && (
                        <span className="inline-flex items-center gap-0.5 font-medium text-[#02C39A]">
                          <CheckCheck className="h-3 w-3" />
                          Read
                        </span>
                      )}
                      {!inbound && m.sequence_step_id && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-[#02C39A]/15 px-1.5 py-0.5 font-medium text-[#028090]">
                          <Zap className="h-3 w-3" />
                          Auto-reply
                        </span>
                      )}
                      {failed && (
                        <span className="font-semibold text-red-600">Failed to send</span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}

            {/* AI drafting indicator — shown only while we're inside
                the post-inbound window AND there's no pending draft
                visible yet. The 2s aggressive poll above will swap
                this for the real composer pre-fill the moment the
                draft is persisted. */}
            {isDrafting && (
              <div
                className="flex items-center gap-2 pl-12 text-[12px] text-[#0B2027]/55"
                aria-live="polite"
              >
                <span
                  className="inline-flex h-1.5 w-1.5 rounded-full bg-[#02C39A] [animation:twin-pulse_1.4s_ease-in-out_infinite]"
                  aria-hidden="true"
                />
                AI drafting…
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Composer ─────────────────────────────────────── */}
      {/* sms_consent isn't on the Contact TS interface yet (DB schema
          has it, /api/leads returns it). Read via cast until the type
          catches up. */}
      <InlineComposer
        contactId={contact.id}
        contactPhone={contact.phone ?? null}
        firstName={contact.first_name}
        smsConsent={(contact as unknown as { sms_consent?: boolean }).sms_consent === true}
        optedOutSms={contact.opted_out_sms === true}
        pendingDraft={pendingDraft}
        onSent={() => load(true)}
        onDraftResolved={() => load(true)}
      />
    </div>
  )
}
