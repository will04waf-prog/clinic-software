'use client'
import { useEffect, useRef, useState } from 'react'
import { Paperclip, Smile, Sparkles, Send } from 'lucide-react'

/**
 * Inline SMS composer for the inbox conversation pane. Sends directly
 * to /api/leads/[id]/send-sms — no modal — so the inbox feels like a
 * messaging app instead of a CRM-form workflow.
 *
 * Behaviour:
 *  - Textarea grows up to ~4 lines, Enter sends, Shift+Enter newlines.
 *  - AI Draft hits /api/leads/[id]/draft-message and replaces the
 *    textarea contents (with a confirm prompt if there's existing
 *    text). Same endpoint the SendSmsDialog uses.
 *  - Opted-out: composer disabled with a red inline notice. Mirrors
 *    the dialog's hard-block.
 *  - No-consent: inline amber notice + a "I have consent" checkbox
 *    must be ticked before sending. Sends with
 *    manual_consent_confirmed: true so the server's audit log
 *    captures it. Mirrors the dialog's TCPA-safe flow exactly.
 *  - Phone missing: composer disabled with notice.
 *  - On success, calls onSent() so the parent pane can refresh its
 *    message list immediately (instead of waiting for the next poll
 *    tick).
 */

interface Props {
  contactId: string
  contactPhone: string | null
  firstName: string
  smsConsent: boolean
  optedOutSms: boolean
  onSent: () => void
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
  onSent,
}: Props) {
  const [body, setBody] = useState('')
  const [consentChecked, setConsentChecked] = useState(false)
  const [status, setStatus] = useState<'idle' | 'sending' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [drafting, setDrafting] = useState(false)
  const [draftError, setDraftError] = useState('')
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
  }, [contactId])

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
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.message ?? json.error ?? `HTTP ${res.status}`)
      // Reset + notify parent. Parent refreshes the message list.
      setBody('')
      setConsentChecked(false)
      setStatus('idle')
      onSent()
    } catch (err: any) {
      setStatus('error')
      setErrorMsg(err.message ?? 'Failed to send')
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
      setBody(json.draft)
      // Focus so the user can keep typing.
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

  return (
    <div className="border-t border-[#0B2027]/8 bg-white px-5 py-3">
      <div className="mx-auto max-w-3xl space-y-2">
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
          <button
            type="button"
            aria-label="Attach file"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#0B2027]/45 hover:bg-[#0B2027]/5 hover:text-[#0B2027]/70 transition-colors"
            disabled
            title="Coming soon"
          >
            <Paperclip className="h-4 w-4" />
          </button>
          <textarea
            ref={textareaRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Write a message…"
            disabled={status === 'sending'}
            rows={1}
            className="flex-1 resize-none bg-transparent text-sm text-[#0B2027] placeholder:text-[#0B2027]/45 focus:outline-none disabled:opacity-60 py-1.5 leading-[22px]"
          />
          <button
            type="button"
            aria-label="Insert emoji"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#0B2027]/45 hover:bg-[#0B2027]/5 hover:text-[#0B2027]/70 transition-colors"
            disabled
            title="Coming soon"
          >
            <Smile className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleDraft}
            disabled={drafting || status === 'sending'}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-[#02C39A] px-3 text-[12px] font-semibold text-[#0B2027] hover:bg-[#02C39A]/90 transition-colors disabled:opacity-60"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {drafting ? 'Drafting…' : 'AI Draft'}
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
