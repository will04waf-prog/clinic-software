'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Mail } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface SendEmailDialogProps {
  contactId:    string
  contactEmail: string | null
  firstName:    string
}

export function SendEmailDialog({ contactId, contactEmail, firstName }: SendEmailDialogProps) {
  const router  = useRouter()
  const [open,     setOpen]     = useState(false)
  const [subject,  setSubject]  = useState('')
  const [body,     setBody]     = useState('')
  const [status,   setStatus]   = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  const hasEmail = !!contactEmail

  async function handleSend() {
    if (!subject.trim() || !body.trim()) return
    setStatus('sending')
    setErrorMsg('')

    try {
      const res  = await fetch(`/api/leads/${contactId}/send-email`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ subject, body }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)

      setStatus('sent')
      setTimeout(() => {
        setOpen(false)
        setStatus('idle')
        setSubject('')
        setBody('')
        router.refresh()
      }, 1200)
    } catch (err: any) {
      setStatus('error')
      setErrorMsg(err.message ?? 'Failed to send')
    }
  }

  function handleOpenChange(v: boolean) {
    if (!v && status === 'sending') return
    setOpen(v)
    if (!v) {
      setStatus('idle')
      setErrorMsg('')
    }
  }

  const busy = status === 'sending' || status === 'sent'

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={!hasEmail}
        title={!hasEmail ? 'No email on file' : undefined}
        onClick={() => hasEmail && setOpen(true)}
      >
        <Mail className="h-4 w-4" />
        Send Email
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Send Email</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* To */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">To</label>
              <input
                type="text"
                value={contactEmail ?? ''}
                readOnly
                className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500"
              />
            </div>

            {/* Subject */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">Subject</label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder={`Following up, ${firstName}`}
                disabled={busy}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-gray-50 disabled:text-gray-400"
              />
            </div>

            {/* Body */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">Message</label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={6}
                placeholder={`Hi {{first_name}},\n\nJust wanted to follow up on your interest in {{procedure_name}}...`}
                disabled={busy}
                className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-gray-50 disabled:text-gray-400"
              />
              <p className="mt-1.5 text-xs text-gray-400">
                Available merge fields:{' '}
                <code className="text-gray-500">{'{{first_name}}'}</code>
                {' · '}
                <code className="text-gray-500">{'{{clinic_name}}'}</code>
                {' · '}
                <code className="text-gray-500">{'{{procedure_name}}'}</code>
              </p>
            </div>

            {/* Error */}
            {status === 'error' && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{errorMsg}</p>
            )}

            {/* Success */}
            {status === 'sent' && (
              <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-600">
                Email sent successfully.
              </p>
            )}
          </div>

          {/* Footer */}
          <div className="mt-6 flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={status === 'sending'}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSend}
              disabled={!subject.trim() || !body.trim() || busy}
            >
              {status === 'sending' ? 'Sending…' : status === 'sent' ? 'Sent' : 'Send'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
