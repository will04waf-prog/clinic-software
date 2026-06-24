'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { Flag, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  FLAG_REASON_CODES,
  FLAG_REASON_LABEL,
  type FlagReasonCode,
} from '@/lib/ai-twin-audit'

/**
 * FlagDraftButton — Phase 2 W11.
 *
 * Reusable button + inline popover that lets the clinic owner flag
 * an autonomous AI Twin send as wrong. Drops into the W11 audit
 * page, the existing /ai-drafts/review rows, and the W10 morning
 * briefing card without those surfaces needing to know anything
 * about the flag API.
 *
 * Design choices worth flagging:
 *   - Inline popover, not a global modal: must work inside table
 *     rows and a dashboard tile without trapping focus to a portal.
 *   - useTransition for the submit so callers can render an
 *     immediate optimistic spinner without lifting state.
 *   - The "honest label" rule: button copy is "Flag this send as
 *     wrong" — not "Report" (sounds punitive), not "Delete"
 *     (lies about behavior — flagging keeps the send and adds a
 *     retraining signal).
 */

export interface FlagDraftButtonProps {
  draftId: string
  alreadyFlagged?: boolean
  /**
   * Called after a successful POST or DELETE. Parents can use this
   * to refetch their list / update a count without lifting state.
   */
  onChange?: () => void
  size?: 'sm' | 'md'
}

type Status = 'idle' | 'submitting' | 'error' | 'duplicate'

export function FlagDraftButton({
  draftId,
  alreadyFlagged = false,
  onChange,
  size = 'sm',
}: FlagDraftButtonProps) {
  const [open, setOpen] = useState(false)
  const [reasonCode, setReasonCode] = useState<FlagReasonCode>('inaccurate')
  const [reasonText, setReasonText] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [flagged, setFlagged] = useState(alreadyFlagged)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const popoverRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => { setFlagged(alreadyFlagged) }, [alreadyFlagged])

  // Click-away + ESC close. Doesn't capture focus in a trap so the
  // surrounding row remains keyboard-operable.
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (!popoverRef.current) return
      if (popoverRef.current.contains(e.target as Node)) return
      if (buttonRef.current && buttonRef.current.contains(e.target as Node)) return
      setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function submitFlag() {
    setStatus('submitting')
    setError(null)
    startTransition(async () => {
      try {
        const res = await fetch('/api/ai-twin/flag', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            draft_id: draftId,
            reason_code: reasonCode,
            reason_text: reasonText.trim() ? reasonText.trim() : undefined,
          }),
        })
        if (res.status === 409) {
          setStatus('duplicate')
          setFlagged(true)
          onChange?.()
          return
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          setStatus('error')
          setError(typeof body.error === 'string' ? body.error : `HTTP ${res.status}`)
          return
        }
        setStatus('idle')
        setFlagged(true)
        setOpen(false)
        setReasonText('')
        onChange?.()
      } catch (err) {
        setStatus('error')
        setError(err instanceof Error ? err.message : 'Network error')
      }
    })
  }

  function undoFlag() {
    setStatus('submitting')
    setError(null)
    startTransition(async () => {
      try {
        const res = await fetch('/api/ai-twin/flag', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ draft_id: draftId }),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          setStatus('error')
          setError(typeof body.error === 'string' ? body.error : `HTTP ${res.status}`)
          return
        }
        setStatus('idle')
        setFlagged(false)
        onChange?.()
      } catch (err) {
        setStatus('error')
        setError(err instanceof Error ? err.message : 'Network error')
      }
    })
  }

  // ── Rendered state: 'flagged' shows a compact undo affordance. ──
  if (flagged) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-full font-medium',
            size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-[12.5px]',
          )}
          style={{ backgroundColor: '#B5710F22', color: '#B5710F' }}
        >
          <Flag className={size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
          Flagged
        </span>
        <button
          type="button"
          onClick={undoFlag}
          disabled={pending}
          className={cn(
            'text-[11px] font-medium underline-offset-2 hover:underline',
            pending ? 'text-[#14241D]/40 cursor-not-allowed' : 'text-[#14241D]/65',
          )}
        >
          {pending ? 'Removing…' : 'Undo'}
        </button>
      </span>
    )
  }

  const sizeBtn =
    size === 'sm'
      ? 'px-2 py-0.5 text-[11px]'
      : 'px-2.5 py-1 text-[12.5px]'

  return (
    <span className="relative inline-block">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(v => !v)}
        className={cn(
          'inline-flex items-center gap-1 rounded-full border font-medium transition-colors',
          sizeBtn,
          open
            ? 'border-[#B5710F]/55 bg-[#B5710F]/10 text-[#B5710F]'
            : 'border-[#14241D]/15 bg-white text-[#14241D]/75 hover:border-[#B5710F]/45 hover:text-[#B5710F]',
        )}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <Flag className={size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
        Flag this send
      </button>

      {open && (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label="Flag this send as wrong"
          className="absolute right-0 z-30 mt-2 w-[320px] rounded-xl border shadow-lg"
          style={{ backgroundColor: '#F5EFE1', borderColor: '#14241D22' }}
        >
          <div className="flex items-start justify-between gap-2 px-3.5 pt-3 pb-1">
            <p
              className="text-[13px] font-semibold"
              style={{ color: '#14241D' }}
            >
              Flag this send as wrong
            </p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-[#14241D]/55 hover:text-[#14241D]"
              aria-label="Close"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="px-3.5 text-[11.5px] text-[#14241D]/65">
            We&apos;ll use this to retrain the AI Twin. The message that already went out won&apos;t be unsent.
          </p>

          <div className="px-3.5 py-3 flex flex-col gap-1.5">
            {FLAG_REASON_CODES.map(code => (
              <label
                key={code}
                className={cn(
                  'flex items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] cursor-pointer',
                  reasonCode === code
                    ? 'bg-[#02C39A]/12 text-[#14241D]'
                    : 'text-[#14241D]/85 hover:bg-[#14241D]/05',
                )}
              >
                <input
                  type="radio"
                  name="flag-reason"
                  value={code}
                  checked={reasonCode === code}
                  onChange={() => setReasonCode(code)}
                  className="accent-[#02C39A]"
                />
                {FLAG_REASON_LABEL[code]}
              </label>
            ))}
          </div>

          <div className="px-3.5 pb-2">
            <label className="block text-[11px] font-medium text-[#14241D]/65 mb-1">
              Optional notes
            </label>
            <textarea
              value={reasonText}
              maxLength={500}
              onChange={e => setReasonText(e.target.value)}
              rows={2}
              placeholder="What should the AI have said instead?"
              className="w-full resize-none rounded-md border bg-white px-2 py-1.5 text-[12.5px] text-[#14241D] placeholder:text-[#14241D]/35 focus:outline-none focus:ring-2 focus:ring-[#02C39A]/40"
              style={{ borderColor: '#14241D22' }}
            />
            <p className="mt-1 text-right text-[10.5px] text-[#14241D]/45">
              {reasonText.length}/500
            </p>
          </div>

          {status === 'error' && error && (
            <p className="px-3.5 pb-2 text-[11px] text-[#B5710F]">
              Couldn&apos;t flag this send: {error}
            </p>
          )}
          {status === 'duplicate' && (
            <p className="px-3.5 pb-2 text-[11px] text-[#14241D]/65">
              You already flagged this send.
            </p>
          )}

          <div
            className="flex items-center justify-end gap-2 border-t px-3.5 py-2.5"
            style={{ borderColor: '#14241D14' }}
          >
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md px-2.5 py-1 text-[12px] font-medium text-[#14241D]/70 hover:bg-[#14241D]/06"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submitFlag}
              disabled={pending || status === 'submitting'}
              className={cn(
                'rounded-md px-3 py-1 text-[12px] font-semibold transition-colors',
                pending || status === 'submitting'
                  ? 'bg-[#B5710F]/45 text-white cursor-not-allowed'
                  : 'bg-[#B5710F] text-white hover:bg-[#9c620a]',
              )}
            >
              {pending || status === 'submitting' ? 'Flagging…' : 'Flag this send'}
            </button>
          </div>
        </div>
      )}
    </span>
  )
}
