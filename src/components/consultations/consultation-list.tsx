'use client'
import { useState } from 'react'
import Link from 'next/link'
import { CalendarCheck, Clock, User, MoreHorizontal, CheckCircle, XCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { formatDateTime, formatProcedure } from '@/lib/utils'
import type { Consultation } from '@/types'

const STATUS_CONFIG = {
  scheduled:   { label: 'Scheduled',   variant: 'default'     as const },
  confirmed:   { label: 'Confirmed',   variant: 'success'     as const },
  completed:   { label: 'Completed',   variant: 'success'     as const },
  no_show:     { label: 'No-Show',     variant: 'destructive' as const },
  canceled:    { label: 'Canceled',    variant: 'secondary'   as const },
  rescheduled: { label: 'Rescheduled', variant: 'warning'     as const },
}

interface ConsultationListProps {
  consultations: Consultation[]
  onRefresh: () => void
}

export function ConsultationList({ consultations, onRefresh }: ConsultationListProps) {
  async function updateStatus(id: string, status: string) {
    await fetch(`/api/consultations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    onRefresh()
  }

  if (consultations.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-12 text-center">
        <CalendarCheck className="mx-auto h-8 w-8 text-gray-300" />
        <p className="mt-3 text-sm font-medium text-gray-500">No consultations found</p>
        <p className="mt-1 text-xs text-gray-400">Book a consultation from a lead profile</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {consultations.map((consult) => {
        const cfg = STATUS_CONFIG[consult.status] ?? STATUS_CONFIG.scheduled
        return (
          <div
            key={consult.id}
            className="flex items-start justify-between rounded-xl border border-gray-200 bg-white p-4 hover:shadow-sm transition-all"
          >
            <div className="flex items-start gap-4">
              {/* Time */}
              <div className="flex flex-col items-center rounded-lg bg-indigo-50 px-3 py-2 text-center min-w-[60px]">
                <span className="text-xs font-medium text-indigo-600">
                  {new Date(consult.scheduled_at).toLocaleDateString('en', { month: 'short' })}
                </span>
                <span className="text-xl font-bold text-indigo-700">
                  {new Date(consult.scheduled_at).getDate()}
                </span>
                <span className="text-xs text-indigo-500">
                  {new Date(consult.scheduled_at).toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' })}
                </span>
              </div>

              {/* Details */}
              <div>
                <div className="flex items-center gap-2">
                  <Link
                    href={`/leads/${consult.contact_id}`}
                    className="font-semibold text-gray-900 hover:text-indigo-600"
                  >
                    {consult.contact?.first_name} {consult.contact?.last_name}
                  </Link>
                  <Badge variant={cfg.variant}>{cfg.label}</Badge>
                  <Badge variant="outline">{consult.type === 'virtual' ? 'Virtual' : 'In-Person'}</Badge>
                </div>

                {(consult.procedure_discussed ?? []).length > 0 && (
                  <p className="mt-1 text-sm text-gray-500">
                    {consult.procedure_discussed!.map(formatProcedure).join(', ')}
                  </p>
                )}

                <div className="mt-1 flex items-center gap-3 text-xs text-gray-400">
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />{consult.duration_min} min
                  </span>
                  {consult.assignee && (
                    <span className="flex items-center gap-1">
                      <User className="h-3 w-3" />{consult.assignee.full_name}
                    </span>
                  )}
                </div>

                {consult.pre_consult_notes && (
                  <p className="mt-1 text-xs text-gray-400 italic">"{consult.pre_consult_notes}"</p>
                )}
              </div>
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => updateStatus(consult.id, 'confirmed')}>
                  Mark Confirmed
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => updateStatus(consult.id, 'completed')}>
                  <CheckCircle className="mr-2 h-4 w-4 text-emerald-500" />
                  Mark Completed
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => updateStatus(consult.id, 'no_show')} className="text-red-600">
                  <XCircle className="mr-2 h-4 w-4" />
                  Mark No-Show
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => updateStatus(consult.id, 'canceled')}>
                  Cancel
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )
      })}
    </div>
  )
}
