'use client'

import { useTransition } from 'react'
import Link from 'next/link'
import { Phone, MessageCircle, AlertTriangle, Check, Undo2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { markResolved, reopenMessage } from '@/app/(dashboard)/voice-messages/actions'
import { ReplyForm } from '@/components/voice-messages/reply-form'

export interface VoiceMessage {
  id:                  string
  caller_name:         string
  caller_phone:        string | null
  message_text:        string
  urgency:             'normal' | 'urgent'
  callback_preference: 'call' | 'text' | 'either'
  status:              'open' | 'resolved'
  call_sid:            string | null
  created_at:          string
}

// Phase 5 W2: orgName is required so the inline ReplyForm can show
// the prefix the patient will see ("{org_name}: <body>"). Passed
// down from the page once per render rather than re-fetched per card.
export function VoiceMessageCard({ message, orgName }: { message: VoiceMessage; orgName: string }) {
  const [pending, startTransition] = useTransition()
  const isOpen = message.status === 'open'
  const urgent = message.urgency === 'urgent'

  const when = new Date(message.created_at).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  })

  const phoneDisplay = message.caller_phone
    ? formatUsPhone(message.caller_phone)
    : 'unknown number'

  const callPref = message.callback_preference === 'call'
    ? <><Phone className="h-3 w-3" /> prefers call back</>
    : message.callback_preference === 'text'
      ? <><MessageCircle className="h-3 w-3" /> prefers text</>
      : <>call or text</>

  return (
    <Card className={urgent && isOpen ? 'border-red-300' : undefined}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-gray-900 truncate">{message.caller_name}</span>
              {urgent && (
                <span className="inline-flex items-center gap-1 rounded-full bg-red-100 text-red-700 text-[10px] px-2 py-0.5 font-medium uppercase tracking-wide">
                  <AlertTriangle className="h-3 w-3" /> urgent
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              <a href={`tel:${message.caller_phone ?? ''}`} className="hover:text-[#02C39A]">{phoneDisplay}</a> ·{' '}
              {message.call_sid ? (
                // Deep-link the timestamp to the full call detail page so
                // the owner can hear the recording and read the transcript
                // that produced this voicemail. The page is owner-scoped
                // and org-scoped by the call_sid lookup, matching the
                // voicemail page's own auth model.
                <Link href={`/calls/${encodeURIComponent(message.call_sid)}`} className="underline decoration-dotted hover:text-[#02C39A]">
                  {when}
                </Link>
              ) : (
                when
              )}
            </p>
          </div>
          {isOpen ? (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => startTransition(async () => { await markResolved(message.id) })}
            >
              <Check className="h-3.5 w-3.5 mr-1" />
              Resolve
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => startTransition(async () => { await reopenMessage(message.id) })}
            >
              <Undo2 className="h-3.5 w-3.5 mr-1" />
              Reopen
            </Button>
          )}
        </div>

        <p className="text-sm text-gray-800 whitespace-pre-wrap">{message.message_text}</p>

        <div className="text-[11px] text-gray-500 flex items-center gap-1.5">
          {callPref}
        </div>

        {/* Inline reply composer — open voicemails only, and only when
            we have a number to text. The form sends the SMS and flips
            the voicemail to 'resolved' in one action, so on success
            this whole card disappears via revalidatePath. */}
        {isOpen && message.caller_phone && (
          <ReplyForm
            messageId={message.id}
            callerPhone={message.caller_phone}
            orgName={orgName}
          />
        )}
      </CardContent>
    </Card>
  )
}

function formatUsPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(-10)
  if (digits.length !== 10) return raw
  return `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`
}
