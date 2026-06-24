'use client'
import { useEffect, useRef, useState } from 'react'
import { Sparkles, Send, X } from 'lucide-react'

/**
 * Inline SMS composer for the inbox conversation pane. Sends directly
 * to /api/leads/[id]/send-sms — no modal — so the inbox feels like a
 * messaging app instead of a CRM-form workflow.
 *
 * AI Front-Desk Twin (Phase 1 Week 2):
 *  - When the parent passes a `pendingDraft`, the composer pre-fills
 *    the textarea with the draft body the first time it's seen and
 *    shows an "AI suggested" banner above the input. The user can
 *    Send (resolves draft as 'sent' with edit_distance=0), edit and
 *    Send (resolves as 'edited' with the real distance), or Discard
 *    (PATCHes the draft to 'rejected').
 *  - draft_id is threaded through the send-sms POST so the server
 *    can compute distance + append the disclosure footer at send
 *    time. The footer is NOT shown in the composer — it's appended
 *    by the route so the user never sees (or can delete) it.
 *  - The manual AI Draft button still works for contacts without an
 *    auto-generated pending draft.
 *
 * Other behaviour preserved:
 *  - Textarea grows up to ~4 lines, Enter sends, Shift+Enter newlines.
 *  - Opted-out: composer disabled with a red inline notice.
 *  - No-consent: amber notice + "I have consent" checkbox required.
 *  - Phone missing: composer disabled with notice.
 *  - On success, calls onSent() so the parent pane refreshes.
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

interface Props {
  contactId: string
  contactPhone: string | null
  firstName: string
  smsConsent: boolean
  optedOutSms: boolean
  pendingDraft?: PendingDraft | null
  onSent: () => void
  onDraftResolved?: () => void
}

function smsSegmentInfo(text: string): { chars: number; segments: number } {
  const chars = text.length
  if (chars === 0) return { chars: 0, segments: 0 }
  return { chars, segments: chars <= 160 ? 1 : Math.ceil(chars / 153) }
}

export function InlineComposer({
  contactId,
  contactPhone,
  firstName,
  smsConsent,
  optedOutSms,
  pendingDraft,
  onSent,
  onDraftResolved,
}: Props) {
  const [body, setBody] = useState('')
  const [consentChecked, setConsentChecked] = useState(false)
  const [status, setStatus] = useState<'idle' | 'sending' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [drafting, setDrafting] = useState(false)
  const [draftError, setDraftError] = useState('')
  // The draft we're currently editing. When the parent passes a new
  // pendingDraft we mirror it into local state; from then on the user
  // owns the body until they Send, Discard, or switch contacts.
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null)
  const [discarding, setDiscarding] = useState(false)
  // True when the current body text was produced by the manual AI
  // Draft button (no persisted ai_drafts row → no draft_id). Tells
  // the send route to append the AI disclosure footer. Cleared when
  // the user clears the field or sends a non-AI message.
  const [aiAuthored, setAiAuthored] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const hasPhone = !!contactPhone
  const needsConsentConfirm = !smsConsent
  const consentSatisfied = smsConsent || consentChecked
  const trimmed = body.trim()
  const canSend =
    hasPhone &&
    !optedOutSms &&
    consentSatisfied &&
    trimmed.length > 0 &&
    status !== 'sending'

  const { chars, segments } = smsSegmentInfo(body)

  // Reset transient state whenever the conversation switches.
  useEffect(() => {
    setBody('')
    setConsentChecked(false)
    setStatus('idle')
    setErrorMsg('')
    setDrafting(false)
    setDraftError('')
    setActiveDraftId(null)
    setDiscarding(false)
  }, [contactId])

  // When a new pending draft arrives (or appears on initial mount),
  // pre-fill the composer. Only if the user hasn't started typing — we
  // never overwrite in-progress text on a poll-tick refresh.
  useEffect(() => {
    if (!pendingDraft) return
    if (pendingDraft.id === activeDraftId) return // already mirrored
    if (body.trim().length > 0 && activeDraftId === null) return // user is mid-type
    setBody(pendingDraft.draft_body)
    setActiveDraftId(pendingDraft.id)
    setStatus('idle')
    setErrorMsg('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingDraft?.id])

  // Auto-grow the textarea up to ~4 lines.
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = '0'
    const max = 4 * 22 // ~22px per line at text-sm
    el.style.height = Math.min(el.scrollHeight, max) + 'px'
  }, [body])

  async function handleSend() {
    if (!canSend) return
    setStatus('sending')
    setErrorMsg('')
    try {
      const res = await fetch(`/api/leads/${contactId}/send-sms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body: trimmed,
          manual_consent_confirmed: needsConsentConfirm ? true : undefined,
          // Pass the draft id when present so the server resolves the
          // draft + appends the disclosure footer. Server tolerates a
          // stale draft id (already resolved → ignored).
          draft_id: activeDraftId ?? undefined,
          // Tell the server to append the AI disclosure footer for
          // manual-AI-drafted sends (no draft_id but still AI-authored).
          is_ai_drafted: aiAuthored || undefined,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.message ?? json.error ?? `HTTP ${res.status}`)
      // Reset + notify parent. Parent refreshes the message list AND
      // the pending-draft endpoint, so the draft pre-fill clears too.
      setBody('')
      setConsentChecked(false)
      setStatus('idle')
      setActiveDraftId(null)
      setAiAuthored(false)
      onSent()
    } catch (err: any) {
      setStatus('error')
      setErrorMsg(err.message ?? 'Failed to send')
    }
  }

  async function handleDiscardDraft() {
    if (!activeDraftId || discarding) return
    setDiscarding(true)
    try {
      const res = await fetch(`/api/ai-drafts/${activeDraftId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject' }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.message ?? json.error ?? `HTTP ${res.status}`)
      }
      setBody('')
      setActiveDraftId(null)
      onDraftResolved?.()
    } catch (err: any) {
      // Failed to discard — show error but don't lose the body.
      setDraftError(err.message ?? 'Failed to discard draft')
    } finally {
      setDiscarding(false)
    }
  }

  async function handleDraft() {
    if (drafting) return
    if (body.trim().length > 0) {
      if (!window.confirm('Replace your current message with an AI draft?')) return
    }
    setDrafting(true)
    setDraftError('')
    try {
      const res = await fetch(`/api/leads/${contactId}/draft-message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: 'sms' }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        const msg = res.status === 429
          ? 'AI draft limit reached. Try again in a bit.'
          : (json.message ?? json.error ?? `HTTP ${res.status}`)
        throw new Error(msg)
      }
      if (typeof json.draft !== 'string' || !json.draft) {
        throw new Error("Couldn't generate a draft — try again.")
      }
      // Manual-draft button doesn't persist an ai_drafts row, so
      // there's no draft_id to bind. We still flag the body as
      // AI-authored so the send route appends the disclosure footer.
      setBody(json.draft)
      setActiveDraftId(null)
      setAiAuthored(true)
      textareaRef.current?.focus()
    } catch (err: any) {
      setDraftError(err.message ?? 'Failed to draft')
    } finally {
      setDrafting(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (canSend) handleSend()
    }
  }

  // Hard-block states have no composer surface.
  if (optedOutSms) {
    return (
      <div className="border-t border-[#0B2027]/8 bg-white px-5 py-4">
        <div className="mx-auto flex max-w-3xl items-center gap-2 rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {firstName} has opted out of SMS. Replies are still received, but
          outbound messages are blocked.
        </div>
      </div>
    )
  }
  if (!hasPhone) {
    return (
      <div className="border-t border-[#0B2027]/8 bg-white px-5 py-4">
        <div className="mx-auto flex max-w-3xl items-center gap-2 rounded-xl bg-[#FAF6EC]/55 border border-[#0B2027]/10 px-3 py-2 text-sm text-[#0B2027]/65">
          No phone number on file. Add one from the lead profile to send SMS.
        </div>
      </div>
    )
  }

  const showingDraft = !!activeDraftId

  return (
    <div className="border-t border-[#0B2027]/8 bg-white px-5 py-3">
      <div className="mx-auto max-w-3xl space-y-2">
        {/* AI draft banner — shown when the textarea contents originated
            from a pending suggestion. Disappears the moment the user
            sends or discards. */}
        {showingDraft && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-[#02C39A]/30 bg-[#02C39A]/[0.08] px-3 py-1.5">
            <p className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#04B08C]">
              <Sparkles className="h-3.5 w-3.5" fill="currentColor" />
              AI suggested · review, edit, or discard
            </p>
            <button
              type="button"
              onClick={handleDiscardDraft}
              disabled={discarding || status === 'sending'}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] font-semibold text-[#0B2027]/70 hover:bg-white hover:text-[#0B2027] transition-colors disabled:opacity-60"
            >
              <X className="h-3 w-3" />
              {discarding ? 'Discarding…' : 'Discard'}
            </button>
          </div>
        )}

        {needsConsentConfirm && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
            <p className="font-medium">No SMS consent on file</p>
            <p className="mt-0.5 text-amber-700/85">
              Only message this contact if you&apos;ve collected consent verbally,
              in person, by email, or recorded phone call.
            </p>
            <label className="mt-2 flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={consentChecked}
                onChange={(e) => setConsentChecked(e.target.checked)}
                disabled={status === 'sending'}
                className="mt-0.5 h-4 w-4 rounded border-amber-400 text-[#028090] focus:ring-[#02C39A]/40"
              />
              <span className="text-amber-900">
                I confirm I have consent to message {firstName}.
              </span>
            </label>
          </div>
        )}

        {/* Composer pill */}
        <div className="flex items-end gap-2 rounded-2xl border border-[#0B2027]/10 bg-[#FAF6EC]/55 px-3 py-2 focus-within:border-[#02C39A]/40 focus-within:bg-white transition-colors">
          <textarea
            ref={textareaRef}
            value={body}
            onChange={(e) => {
              setBody(e.target.value)
              // If the user clears the field, the next message is no
              // longer AI-authored. Editing the AI's draft text still
              // counts as AI-authored (matches the W7 edit-distance
              // semantics — small edits stay attributed to the AI).
              if (e.target.value.length === 0) setAiAuthored(false)
            }}
            onKeyDown={handleKeyDown}
            placeholder={showingDraft ? 'AI draft above — edit or send as-is' : 'Write a message…'}
            disabled={status === 'sending'}
            rows={1}
            className="flex-1 resize-none bg-transparent text-sm text-[#0B2027] placeholder:text-[#0B2027]/45 focus:outline-none disabled:opacity-60 py-1.5 leading-[22px]"
          />
          {/* The manual AI Draft button stays available even when a
              pending draft is loaded, so the user can re-roll if the
              suggestion is off. Calling it clears the draft binding so
              the next send is treated as a manual send. */}
          <button
            type="button"
            onClick={handleDraft}
            disabled={drafting || status === 'sending'}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-[#02C39A] px-3 text-[12px] font-semibold text-[#0B2027] hover:bg-[#02C39A]/90 transition-colors disabled:opacity-60"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {drafting ? 'Drafting…' : showingDraft ? 'Re-draft' : 'AI Draft'}
          </button>
          <button
            type="button"
            onClick={handleSend}
            disabled={!canSend}
            aria-label="Send message"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#0B2027] text-[#FAF6EC] hover:bg-[#0B2027]/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Meta row — segment counter + errors */}
        <div className="flex items-center justify-between gap-3 px-1 text-[11px]">
          <div className="flex items-center gap-2">
            {draftError && (
              <span className="text-red-600">{draftError}</span>
            )}
            {status === 'error' && (
              <span className="text-red-600">{errorMsg}</span>
            )}
          </div>
          {chars > 0 && (
            <span className={segments > 1 ? 'font-medium text-amber-700' : 'text-[#0B2027]/40'}>
              {chars} char{chars === 1 ? '' : 's'} · {segments} segment{segments === 1 ? '' : 's'}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
