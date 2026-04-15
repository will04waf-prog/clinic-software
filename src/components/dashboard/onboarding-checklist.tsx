'use client'

import { useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, Circle, Copy, Check } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface OnboardingChecklistProps {
  hasLeads: boolean
  hasConsultations: boolean
  hasAutomations: boolean
  captureUrl: string
}

export function OnboardingChecklist({
  hasLeads,
  hasConsultations,
  hasAutomations,
  captureUrl,
}: OnboardingChecklistProps) {
  const [copied, setCopied] = useState(false)

  const allDone = hasLeads && hasConsultations && hasAutomations
  if (allDone) return null

  const doneCount = [hasLeads, hasConsultations, hasAutomations].filter(Boolean).length

  function copyUrl() {
    navigator.clipboard.writeText(captureUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const steps = [
    {
      done: hasLeads,
      label: 'Add your first lead',
      description: 'Manually add a lead or let your capture form do it automatically.',
      href: '/leads',
      cta: 'Go to Leads',
    },
    {
      done: hasConsultations,
      label: 'Schedule a consultation',
      description: 'Book a consultation with one of your leads.',
      href: '/consultations',
      cta: 'Go to Consultations',
    },
    {
      done: hasAutomations,
      label: 'Create an automation',
      description: 'Set up a follow-up sequence to engage leads automatically.',
      href: '/automations',
      cta: 'Go to Automations',
    },
  ]

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Get started with Tarhunna</CardTitle>
          <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-500">
            {doneCount} of 3 complete
          </span>
        </div>

        {/* Capture form CTA */}
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-indigo-50 px-3 py-2.5">
          <p className="min-w-0 flex-1 truncate text-sm text-indigo-700">
            <span className="font-medium">Your capture form is live —</span>{' '}
            <span className="text-indigo-500">{captureUrl}</span>
          </p>
          <button
            onClick={copyUrl}
            className="flex shrink-0 items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-800"
          >
            {copied
              ? <Check className="h-3.5 w-3.5" />
              : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        <div className="space-y-2">
          {steps.map((step) => (
            <div
              key={step.label}
              className={`flex items-start gap-3 rounded-lg border p-3 ${
                step.done
                  ? 'border-emerald-100 bg-emerald-50'
                  : 'border-gray-100 bg-white'
              }`}
            >
              {step.done
                ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
                : <Circle className="mt-0.5 h-5 w-5 shrink-0 text-gray-300" />}

              <div className="min-w-0 flex-1">
                <p className={`text-sm font-medium ${
                  step.done
                    ? 'text-emerald-700 line-through decoration-emerald-300'
                    : 'text-gray-900'
                }`}>
                  {step.label}
                </p>
                {!step.done && (
                  <p className="mt-0.5 text-xs text-gray-500">{step.description}</p>
                )}
              </div>

              {!step.done && (
                <Link
                  href={step.href}
                  className="shrink-0 whitespace-nowrap text-xs font-semibold text-indigo-600 hover:text-indigo-800"
                >
                  {step.cta} →
                </Link>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
