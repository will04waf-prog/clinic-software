'use client'

import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface LeadSummaryCardProps {
  contactId: string
  className?: string
}

export function LeadSummaryCard({ contactId, className }: LeadSummaryCardProps) {
  const [summary, setSummary] = useState<string | null>(null)
  const [status,  setStatus]  = useState<'idle' | 'loading' | 'error'>('idle')
  const [error,   setError]   = useState('')

  async function handleSummarize() {
    if (status === 'loading') return
    setStatus('loading')
    setError('')
    try {
      const res = await fetch(`/api/leads/${contactId}/summary`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        const msg = res.status === 429
          ? 'AI summary limit reached for this hour — try again shortly.'
          : (json.message ?? json.error ?? "Couldn't generate summary — try again.")
        throw new Error(msg)
      }
      if (typeof json.summary !== 'string' || !json.summary) {
        throw new Error("Couldn't generate summary — try again.")
      }
      setSummary(json.summary)
      setStatus('idle')
    } catch (err: any) {
      setError(err.message ?? "Couldn't generate summary — try again.")
      setStatus('error')
    }
  }

  const hasSummary  = summary !== null
  const buttonLabel =
    status === 'loading' ? 'Summarizing…' :
    hasSummary           ? 'Regenerate'   :
                            'Summarize with AI'

  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Lead Summary</CardTitle>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={handleSummarize}
          disabled={status === 'loading'}
        >
          <Sparkles className="h-3.5 w-3.5" />
          {buttonLabel}
        </Button>
      </CardHeader>
      <CardContent>
        {summary ? (
          <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">{summary}</p>
        ) : (
          <p className="text-sm text-gray-400">
            Click Summarize with AI to generate a brief status of where this lead stands.
          </p>
        )}

        {status === 'error' && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>
        )}
      </CardContent>
    </Card>
  )
}
