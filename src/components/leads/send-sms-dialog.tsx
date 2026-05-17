'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { MessageSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { formatPhone } from '@/lib/utils'

interface SendSmsDialogProps {
  contactId:    string
  contactPhone: string | null
  firstName:    string
  smsConsent:   boolean
  optedOutSms:  boolean
}

// GSM-7 single-segment cap is 160 chars. Multi-segment messages reserve
// 7 chars per part for User Data Header → 153 usable per segment.
// UCS-2 (emoji / non-Latin) refinement is a follow-up.
function smsSegmentInfo(text: string): { chars: number; segments: number } {
  const chars = text.length
  if (chars === 0) return { chars: 0, segments: 0 }
  return { chars, segments: chars <= 160 ? 1 : Math.ceil(chars / 153) }
}

export function SendSmsDialog({
  contactId,
  contactPhone,
  firstName,
  smsConsent,
  optedOutSms,
}: SendSmsDialogProps) {
  const router = useRouter()
  const [open,             setOpen]             = useState(false)
  const [body,             setBody]             = useState('')
  const [consentChecked,   setConsentChecked]   = useState(false)
  const [status,           setStatus]           = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [errorMsg,         setErrorMsg]         = useState('')

  // Props drive the gate every render — never copied into state, so a
  // STOP received between page load and dialog open is reflected as soon
  // as the parent server component re-fetches (router.refresh / nav).
  const hasPhone   = !!contactPhone
  const canTrigger = hasPhone && !optedOutSms

  const triggerTitle =
    !hasPhone       ? 'No phone number on file' :
    optedOutSms     ? 'This contact has opted out of SMS' :
                      undefined

  // Reset transient dialog state whenever the dialog closes.
  useEffect(() => {
    if (open) return
    setBody('')
    setConsentChecked(false)
    setStatus('idle')
    setErrorMsg('')
  }, [open])

  const { chars, segments } = smsSegmentInfo(body)
  const needsConsentConfirm = !smsConsent
  const consentSatisfied    = smsConsent || consentChecked
  const busy                = status === 'sending' || status === 'sent'
  const canSend             = body.trim().length > 0 && consentSatisfied && !busy

  function handleOpenChange(v: boolean) {
    if (!v && status === 'sending') return
    setOpen(v)
  }

  async function handleSend() {
    if (!canSend) return
    setStatus('sending')
    setErrorMsg('')

    try {
      const res = await fetch(`/api/leads/${contactId}/send-sms`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          body,
          manual_consent_confirmed: needsConsentConfirm ? true : undefined,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.message ?? json.error ?? `HTTP ${res.status}`)

      setStatus('sent')
      setTimeout(() => {
        setOpen(false)
        router.refresh()
      }, 1200)
    } catch (err: any) {
      setStatus('error')
      setErrorMsg(err.message ?? 'Failed to send')
    }
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={!canTrigger}
        title={triggerTitle}
        onClick={() => canTrigger && setOpen(true)}
      >
        <MessageSquare className="h-4 w-4" />
        Send SMS
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Send SMS</DialogTitle>
          </DialogHeader>

          {/* Defense in depth: trigger should already be disabled, but if
              opted-out state somehow flipped between open and now, never
              render the composer. */}
          {optedOutSms ? (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-3 text-sm text-red-700">
              This contact has opted out of SMS messages. You cannot send them an SMS.
            </div>
          ) : (
            <div className="space-y-4">
              {/* To */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">To</label>
                <input
                  type="text"
                  value={contactPhone ? formatPhone(contactPhone) : ''}
                  readOnly
                  className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500"
                />
              </div>

              {/* No-consent soft warning */}
              {needsConsentConfirm && (
                <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-700">
                  This contact has not provided written SMS consent. Only proceed if you have collected consent verbally or in person.
                </div>
              )}

              {/* Body */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">Message</label>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={5}
                  placeholder={`Hi ${firstName}, ...`}
                  disabled={busy}
                  className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-gray-50 disabled:text-gray-400"
                />
                <div className="mt-1.5 flex items-start justify-between gap-3 text-xs">
                  <p className="text-gray-400">
                    Merge fields:{' '}
                    <code className="text-gray-500">{'{{first_name}}'}</code>
                    {' · '}
                    <code className="text-gray-500">{'{{clinic_name}}'}</code>
                  </p>
                  <p className={segments > 1 ? 'text-amber-600 font-medium' : 'text-gray-400'}>
                    {chars} char{chars === 1 ? '' : 's'} · {segments} segment{segments === 1 ? '' : 's'}
                  </p>
                </div>
                {segments > 1 && (
                  <p className="mt-1 text-xs text-amber-600">
                    This message will be sent as {segments} segments and billed accordingly.
                  </p>
                )}
              </div>

              {/* Consent confirmation checkbox */}
              {needsConsentConfirm && (
                <label className="flex items-start gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={consentChecked}
                    onChange={(e) => setConsentChecked(e.target.checked)}
                    disabled={busy}
                    className="mt-0.5 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span>I confirm I have consent to message this contact.</span>
                </label>
              )}

              {/* Error */}
              {status === 'error' && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{errorMsg}</p>
              )}

              {/* Success */}
              {status === 'sent' && (
                <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-600">
                  SMS sent successfully.
                </p>
              )}
            </div>
          )}

          {/* Footer */}
          <div className="mt-6 flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={status === 'sending'}
            >
              {optedOutSms ? 'Close' : 'Cancel'}
            </Button>
            {!optedOutSms && (
              <Button onClick={handleSend} disabled={!canSend}>
                {status === 'sending' ? 'Sending…' : status === 'sent' ? 'Sent' : 'Send'}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
