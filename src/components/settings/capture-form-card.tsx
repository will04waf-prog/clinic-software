'use client'

import { useState } from 'react'
import { Copy, Check, ExternalLink } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

interface CaptureFormCardProps {
  url: string
  /**
   * Vertical-aware copy: loop (landscaping/trades) orgs talk about
   * customers requesting estimates, in the owner's language; legacy
   * med-spa orgs keep the original patient/consultation wording.
   */
  variant?: 'medspa' | 'loop-en' | 'loop-es'
}

const COPY = {
  medspa:    { title: 'Intake Form',        sub: 'Share this link with patients to collect consultation requests.' },
  'loop-en': { title: 'Request Form',       sub: 'Share this link so customers can request an estimate.' },
  'loop-es': { title: 'Formulario de solicitudes', sub: 'Comparta este enlace para que sus clientes pidan un estimado.' },
} as const

export function CaptureFormCard({ url, variant = 'medspa' }: CaptureFormCardProps) {
  const [copied, setCopied] = useState(false)
  const copy = COPY[variant]

  async function handleCopy() {
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{copy.title}</CardTitle>
        <p className="text-sm text-gray-500 mt-1">
          {copy.sub}
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
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
          </Button>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 inline-flex items-center justify-center h-7 px-2 rounded-md text-sm text-gray-500 hover:text-brand-600 hover:bg-gray-100 transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </CardContent>
    </Card>
  )
}
