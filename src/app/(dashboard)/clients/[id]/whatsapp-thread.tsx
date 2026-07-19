'use client'

/**
 * WhatsApp thread on the client record (integrations build 2026-07-18).
 * A deliberately simple sibling of the med-spa ConversationPane: same
 * proven skeleton (poll + signature diff, visibility pause, bubbles,
 * auto-scroll) without the med-spa chrome. Brand palette, dict-localized.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Send, Loader2, Phone, MessageCircle, Clock } from 'lucide-react'
import { dict, type Locale } from '@/lib/i18n'

interface ThreadMessage {
  id: string
  direction: 'inbound' | 'outbound'
  status: string
  body: string
  created_at: string
}

interface ThreadState {
  messages: ThreadMessage[]
  windowOpen: boolean
  whatsappEnabled: boolean
}

const POLL_MS = 15_000

export function WhatsAppThread({
  locale,
  contactId,
  contactName,
  contactPhone,
}: {
  locale: Locale
  contactId: string
  contactName: string
  contactPhone: string | null
}) {
  const t = dict(locale).inbox
  const [state, setState] = useState<ThreadState | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const sigRef = useRef('')
  const bottomRef = useRef<HTMLDivElement | null>(null)

  const load = useCallback(async () => {
    if (document.visibilityState === 'hidden') return
    try {
      const res = await fetch(`/api/clients/${contactId}/whatsapp`, { cache: 'no-store' })
      if (!res.ok) throw new Error()
      const body = await res.json()
      const sig = JSON.stringify([body.messages?.length, body.messages?.at?.(-1)?.id, body.windowOpen])
      if (sig !== sigRef.current) {
        sigRef.current = sig
        setState({
          messages: body.messages ?? [],
          windowOpen: !!body.windowOpen,
          whatsappEnabled: !!body.whatsappEnabled,
        })
      }
      setLoadError(false)
    } catch {
      if (!state) setLoadError(true)
    }
  }, [contactId, state])

  useEffect(() => {
    load()
    const iv = setInterval(load, POLL_MS)
    return () => clearInterval(iv)
  }, [load])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [state?.messages.length])

  async function send() {
    const body = draft.trim()
    if (!body || sending) return
    setSending(true)
    setSendError('')
    try {
      const res = await fetch(`/api/clients/${contactId}/whatsapp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      })
      const out = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (out.error === 'window_closed') {
          // Window slipped shut between poll and send — refresh the UI.
          sigRef.current = ''
          await load()
        }
        setSendError(t.errSend)
        return
      }
      setDraft('')
      if (out.message) {
        setState(prev => prev ? { ...prev, messages: [...prev.messages, out.message] } : prev)
      } else {
        sigRef.current = ''
        await load()
      }
    } catch {
      setSendError(t.errSend)
    } finally {
      setSending(false)
    }
  }

  const timeFmt = new Intl.DateTimeFormat(locale === 'es' ? 'es-US' : 'en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })

  return (
    <div className="mx-auto flex h-full w-full max-w-2xl flex-col px-4 py-4">
      {/* Header */}
      <div className="mb-3 flex items-center gap-3">
        <Link
          href="/clients"
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-500"
          aria-label={t.back}
        >
          <ArrowLeft className="h-4.5 w-4.5" />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold text-[#0B2027]">{contactName}</p>
          {contactPhone && (
            <a href={`tel:${contactPhone}`} className="mt-0.5 inline-flex items-center gap-1 text-xs text-gray-500">
              <Phone className="h-3 w-3" /> {contactPhone}
            </a>
          )}
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#02C39A]/15 px-3 py-1 text-xs font-semibold text-[#0B7A5E]">
          <MessageCircle className="h-3.5 w-3.5" /> {t.title}
        </span>
      </div>

      {/* Thread */}
      <div className="flex-1 space-y-2 overflow-y-auto rounded-2xl border border-gray-200 bg-white p-4">
        {state === null && !loadError && (
          <div className="space-y-2">
            <div className="h-10 w-3/5 animate-pulse rounded-2xl bg-gray-100" />
            <div className="ml-auto h-10 w-1/2 animate-pulse rounded-2xl bg-gray-100" />
            <div className="h-10 w-2/5 animate-pulse rounded-2xl bg-gray-100" />
          </div>
        )}
        {loadError && <p className="text-sm text-red-600">{t.loadError}</p>}
        {state !== null && state.messages.length === 0 && (
          <p className="py-8 text-center text-sm leading-relaxed text-gray-400">{t.empty}</p>
        )}
        {(state?.messages ?? []).map(m => (
          <div
            key={m.id}
            className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-[14px] leading-relaxed ${
              m.direction === 'outbound'
                ? 'ml-auto bg-[#0B2027] text-[#F5EFE1]'
                : 'bg-[#F5EFE1] text-[#0B2027]'
            }`}
          >
            <p className="whitespace-pre-line break-words">{m.body}</p>
            <p className={`mt-1 text-[10.5px] ${m.direction === 'outbound' ? 'text-[#F5EFE1]/50' : 'text-[#7E8C90]'}`}>
              {timeFmt.format(new Date(m.created_at))}
            </p>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Composer / window state */}
      {state !== null && (
        !state.whatsappEnabled ? (
          <p className="mt-3 rounded-xl bg-gray-100 px-4 py-3 text-sm text-gray-500">{t.whatsappOffBody}</p>
        ) : state.windowOpen ? (
          <div className="mt-3">
            {sendError && <p className="mb-2 text-xs text-red-600">{sendError}</p>}
            <div className="flex items-end gap-2">
              <textarea
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                placeholder={t.composerPlaceholder}
                rows={2}
                className="min-h-12 flex-1 resize-none rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-base text-gray-900 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              />
              <button
                type="button"
                onClick={send}
                disabled={sending || !draft.trim()}
                className="inline-flex h-12 min-w-12 items-center justify-center rounded-xl bg-[#028090] px-4 text-white transition hover:bg-[#026B78] disabled:opacity-50"
                aria-label={t.send}
              >
                {sending ? <Loader2 className="h-4.5 w-4.5 animate-spin" /> : <Send className="h-4.5 w-4.5" />}
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex items-start gap-2.5 rounded-xl bg-[#F5EFE1]/70 px-4 py-3">
            <Clock className="mt-0.5 h-4 w-4 shrink-0 text-[#7E8C90]" />
            <div>
              <p className="text-sm font-semibold text-[#0B2027]">{t.windowClosedTitle}</p>
              <p className="mt-0.5 text-[13px] leading-relaxed text-[#5A6A70]">{t.windowClosedBody}</p>
            </div>
          </div>
        )
      )}
    </div>
  )
}
