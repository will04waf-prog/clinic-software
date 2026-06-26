'use client'

/**
 * Phase 4 W6 — click-to-open detail panel for a calendar consultation.
 *
 * Mounted at the page level, driven by ?selected=<consultation_id>
 * URL state. The calendar grid sets the URL via onSelect; the sheet
 * reads it back and renders. Closing the sheet clears the URL.
 *
 * Built on top of the existing Radix Dialog primitive (no new dep);
 * styled as a side-anchored sheet rather than a centered modal so it
 * coexists naturally with the calendar grid.
 *
 * Status mutation reuses PATCH /api/consultations/[id] verbatim, the
 * same endpoint the existing ConsultationList hits.
 */

import { useState } from 'react'
import Link from 'next/link'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X, User, Calendar, Clock, ChevronRight, CheckCircle, XCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Consultation } from '@/types'

const STATUS_CONFIG = {
  hold:        { label: 'On hold',     variant: 'warning'     as const },
  scheduled:   { label: 'Scheduled',   variant: 'default'     as const },
  confirmed:   { label: 'Confirmed',   variant: 'success'     as const },
  completed:   { label: 'Completed',   variant: 'success'     as const },
  no_show:     { label: 'No-Show',     variant: 'destructive' as const },
  canceled:    { label: 'Canceled',    variant: 'secondary'   as const },
  rescheduled: { label: 'Rescheduled', variant: 'warning'     as const },
}

interface Props {
  consultation: Consultation | null
  timezone: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onMutated: () => void
}

export function ConsultationDetailSheet({
  consultation, timezone, open, onOpenChange, onMutated,
}: Props) {
  const [pending, setPending] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  async function updateStatus(status: string) {
    if (!consultation) return
    setPending(true)
    setError(null)
    try {
      const res = await fetch(`/api/consultations/${consultation.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.message ?? j.error ?? `HTTP ${res.status}`)
      }
      onMutated()
      onOpenChange(false)
    } catch (err: any) {
      setError(err?.message || 'Could not update status')
    } finally {
      setPending(false)
    }
  }

  const c = consultation
  const cfg = c ? (STATUS_CONFIG[c.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.scheduled) : null
  const contactName = c ? [c.contact?.first_name, c.contact?.last_name].filter(Boolean).join(' ') : ''
  const longFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })
  const timeFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hour: 'numeric', minute: '2-digit', hour12: true,
  })

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/30 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <DialogPrimitive.Content
          className="fixed right-0 top-0 z-50 h-dvh w-full max-w-md overflow-y-auto border-l border-[#0B2027]/10 bg-white shadow-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right"
        >
          <DialogPrimitive.Title className="sr-only">Consultation details</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            {c
              ? `${contactName || 'Unknown'} — ${longFmt.format(new Date(c.scheduled_at))} at ${timeFmt.format(new Date(c.scheduled_at))}. Status ${cfg?.label ?? 'unknown'}.`
              : 'Loading consultation details.'}
          </DialogPrimitive.Description>

          <div className="flex items-center justify-between border-b border-[#0B2027]/10 px-5 py-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#04B08C]">Consultation</p>
              {cfg && <Badge variant={cfg.variant} className="mt-1">{cfg.label}</Badge>}
            </div>
            <DialogPrimitive.Close
              aria-label="Close"
              className="rounded-md p-1.5 text-[#4A5A60] hover:bg-[#FAF6EC]"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </DialogPrimitive.Close>
          </div>

          {!c ? (
            <div className="px-5 py-8 text-center text-[13px] text-[#7E8C90]">
              Loading consultation details…
            </div>
          ) : (
            <div className="space-y-5 px-5 py-5">
              {/* ── Patient ── */}
              <section>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[#4A5A60]">Patient</p>
                <div className="mt-1 flex items-center justify-between">
                  <p className="text-[15px] font-semibold text-[#14241D]">
                    {contactName || 'Unknown contact'}
                  </p>
                  {c.contact?.id && (
                    <Link
                      href={`/leads?c=${c.contact.id}`}
                      className="inline-flex items-center gap-0.5 text-[12px] font-medium text-[#04B08C] hover:underline"
                    >
                      Open <ChevronRight className="h-3.5 w-3.5" />
                    </Link>
                  )}
                </div>
                {(c.contact?.phone || c.contact?.email) && (
                  <p className="text-[12.5px] text-[#4A5A60]">
                    {c.contact?.phone}{c.contact?.phone && c.contact?.email ? ' · ' : ''}{c.contact?.email}
                  </p>
                )}
              </section>

              {/* ── Time ── */}
              <section>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[#4A5A60]">When</p>
                <p className="mt-1 text-[14px] font-semibold text-[#14241D]">
                  {longFmt.format(new Date(c.scheduled_at))}
                </p>
                <p className="text-[12.5px] text-[#4A5A60]">
                  <Clock className="mr-1 inline h-3.5 w-3.5 align-text-bottom" />
                  {timeFmt.format(new Date(c.scheduled_at))} · {c.duration_min} min
                </p>
              </section>

              {/* ── Service + Provider ── */}
              <section>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[#4A5A60]">Service</p>
                <p className="mt-1 text-[14px] text-[#14241D]">
                  {c.service?.name ?? c.procedure_discussed?.[0] ?? c.type ?? '—'}
                </p>
                {c.provider && (
                  <p className="mt-1.5 text-[12.5px] text-[#4A5A60]">
                    <User className="mr-1 inline h-3.5 w-3.5 align-text-bottom" />
                    with {c.provider.display_name}
                  </p>
                )}
                {!c.provider && c.assignee?.full_name && (
                  <p className="mt-1.5 text-[12.5px] text-[#4A5A60]">
                    <User className="mr-1 inline h-3.5 w-3.5 align-text-bottom" />
                    assigned to {c.assignee.full_name}
                  </p>
                )}
              </section>

              {/* ── Pre-consult notes ── */}
              {c.pre_consult_notes && (
                <section>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-[#4A5A60]">Patient note</p>
                  <p className="mt-1 whitespace-pre-wrap rounded-md border border-[#0B2027]/10 bg-[#FAF6EC]/60 px-3 py-2 text-[13px] text-[#14241D]">
                    {c.pre_consult_notes}
                  </p>
                </section>
              )}

              {/* ── Actions ── */}
              {c.status !== 'canceled' && c.status !== 'completed' && (
                <section className="border-t border-[#0B2027]/10 pt-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-[#4A5A60]">Mark as</p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {c.status !== 'confirmed' && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => updateStatus('confirmed')}
                        disabled={pending}
                        className="justify-start"
                      >
                        <CheckCircle className="mr-1.5 h-3.5 w-3.5 text-[#04B08C]" />
                        Confirmed
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => updateStatus('completed')}
                      disabled={pending}
                      className="justify-start"
                    >
                      <CheckCircle className="mr-1.5 h-3.5 w-3.5 text-gray-500" />
                      Completed
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => updateStatus('no_show')}
                      disabled={pending}
                      className="justify-start"
                    >
                      <XCircle className="mr-1.5 h-3.5 w-3.5 text-red-500" />
                      No-show
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => updateStatus('canceled')}
                      disabled={pending}
                      className={cn('justify-start', 'text-[#B5710F]')}
                    >
                      <XCircle className="mr-1.5 h-3.5 w-3.5" />
                      Cancel
                    </Button>
                  </div>
                  {error && (
                    <p className="mt-2 text-[12px] text-red-600">{error}</p>
                  )}
                </section>
              )}

              <div className="border-t border-[#0B2027]/10 pt-3 text-[11px] text-[#7E8C90]">
                <Calendar className="mr-1 inline h-3 w-3 align-text-bottom" />
                Booked via {c.booked_via ?? 'manual'}
              </div>
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
