'use client'

/**
 * Inline reply composer for the voice-messages inbox.
 *
 * Rendered under each OPEN voicemail card. On submit it calls the
 * sendVoiceMessageReply server action, which sends the SMS and flips
 * the voicemail to 'resolved' — so on success the card disappears
 * via the page's revalidatePath. We don't optimistically remove the
 * card here; the server-action revalidate + router refresh is what
 * makes the surface consistent.
 *
 * Char limit: hard cap at 320 (two SMS segments). The server action
 * re-enforces this; the counter here is for the owner's benefit so
 * they can see they're about to fragment the message.
 *
 * Disabled when caller_phone is null — VoiceMessageCard does not
 * mount this component in that case, but we also disable the Send
 * button defensively so a future re-mount cannot send to nothing.
 */

import { useState, useTransition } from 'react'
import { Send, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { sendVoiceMessageReply } from '@/app/(dashboard)/voice-messages/reply-action'

const MAX_CHARS = 320

interface ReplyFormProps {
  messageId:    string
  callerPhone:  string | null
  orgName:      string
}

export function ReplyForm({ messageId, callerPhone, orgName }: ReplyFormProps) {
  const [body, setBody]       = useState('')
  const [error, setError]     = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const trimmed   = body.trim()
  const charCount = body.length
  const canSend   = trimmed.length > 0 && charCount <= MAX_CHARS && !!callerPhone && !pending

  // Preview of what the patient will see — same shape as the server
  // action's render path so what-you-see is what-gets-sent. We do not
  // re-derive the STOP footer here because the server is the source
  // of truth and a body that already includes "STOP" should not double
  // up; the owner can self-check by reading the textarea.
  const previewPrefix = `${orgName}: `

  function onSend() {
    setError(null)
    startTransition(async () => {
      const res = await sendVoiceMessageReply({ messageId, body: trimmed })
      if (!('ok' in res) || !res.ok) {
        setError(reasonToMessage(res.error))
        return
      }
      // Success — card will collapse via revalidatePath.
      setBody('')
    })
  }

  if (!callerPhone) {
    // VoiceMessageCard already gates on caller_phone, but rendering
    // this branch defensively keeps the component honest if reused.
    return null
  }

  return (
    <div className="rounded-md border border-gray-200 bg-gray-50/50 p-3 space-y-2">
      <div className="text-[11px] text-gray-500">
        Reply via SMS — will be prefixed with <span className="font-medium">{previewPrefix.trim()}</span>
      </div>
      <textarea
        value={body}
        onChange={e => setBody(e.target.value)}
        rows={3}
        maxLength={MAX_CHARS + 50 /* soft guard — server re-validates */}
        placeholder="Type your reply…"
        className="block w-full resize-y rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-[#02C39A] focus:outline-none focus:ring-1 focus:ring-[#02C39A] disabled:opacity-60"
        style={{ maxHeight: '12rem' }}
        disabled={pending}
      />
      <div className="flex items-center justify-between gap-2">
        <span
          className={
            charCount > MAX_CHARS
              ? 'text-[11px] font-medium text-red-600'
              : 'text-[11px] text-gray-500'
          }
        >
          {charCount}/{MAX_CHARS}
        </span>
        <Button
          size="sm"
          onClick={onSend}
          disabled={!canSend}
          className="bg-[#02C39A] hover:bg-[#02C39A]/90 text-white"
        >
          <Send className="h-3.5 w-3.5 mr-1" />
          {pending ? 'Sending…' : 'Send reply'}
        </Button>
      </div>
      {error && (
        <div className="flex items-start gap-1.5 text-xs text-red-700">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
    </div>
  )
}

// Map server-action error codes to owner-facing copy. We deliberately
// keep these short and PHI-free — no patient name or number ever
// surfaces in an error banner.
function reasonToMessage(reason: string): string {
  switch (reason) {
    case 'rate_limited':         return 'Too many reply attempts for this voicemail. Try again in an hour.'
    case 'already_resolved':     return 'This voicemail is already resolved. Refresh to see latest.'
    case 'no_caller_phone':      return 'No caller phone on file — cannot reply by SMS.'
    case 'contact_opted_out':    return 'This contact has opted out of SMS.'
    case 'sms_disabled':         return 'SMS is disabled for this clinic. Enable it in Settings before replying.'
    case 'twilio_not_configured':return 'SMS is not configured for this environment.'
    case 'not_owner':            return 'Only an active owner can reply from the voicemail inbox.'
    case 'body_too_long':        return `Reply must be ${MAX_CHARS} characters or fewer.`
    case 'empty_body':           return 'Please type a reply before sending.'
    case 'send_failed':          return 'SMS send failed. Try again, or contact support if this persists.'
    default:                     return 'Could not send reply. Try again.'
  }
}
