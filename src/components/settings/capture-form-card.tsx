'use client'

import { useState } from 'react'
import { Copy, Check, ExternalLink } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

interface CaptureFormCardProps {
  url: string
}

export function CaptureFormCard({ url }: CaptureFormCardProps) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Intake Form</CardTitle>
        <p className="text-sm text-gray-500 mt-1">
          Share this link with patients to collect consultation requests.
        </p>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
          <span className="flex-1 truncate text-sm text-gray-700 font-mono">{url}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="shrink-0 h-7 px-2"
            onClick={handleCopy}
          >
            {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
          </Button>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 inline-flex items-center justify-center h-7 px-2 rounded-md text-sm text-gray-500 hover:text-indigo-600 hover:bg-gray-100 transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </CardContent>
    </Card>
  )
}
