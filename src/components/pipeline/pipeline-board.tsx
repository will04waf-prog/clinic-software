'use client'
import { useState } from 'react'
import Link from 'next/link'
import { Mail, Phone, MoreHorizontal } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatRelative, formatProcedure } from '@/lib/utils'
import type { PipelineColumn, PipelineContact } from '@/types'

interface PipelineBoardProps {
  columns: PipelineColumn[]
  onStageChange: (contactId: string, stageId: string) => void
}

function ContactCard({ contact, onMove, stages }: {
  contact: PipelineContact
  onMove: (stageId: string) => void
  stages: { id: string; name: string }[]
}) {
  return (
    <div className="group rounded-lg border border-gray-200 bg-white p-3 shadow-sm hover:shadow-md transition-all cursor-pointer">
      <Link href={`/leads/${contact.id}`}>
        <p className="font-medium text-sm text-gray-900 group-hover:text-indigo-600">
          {contact.first_name} {contact.last_name}
        </p>
      </Link>

      {/* Contact info */}
      <div className="mt-1.5 space-y-0.5">
        {contact.email && (
          <p className="flex items-center gap-1.5 text-xs text-gray-400">
            <Mail className="h-3 w-3" />{contact.email}
          </p>
        )}
        {contact.phone && (
          <p className="flex items-center gap-1.5 text-xs text-gray-400">
            <Phone className="h-3 w-3" />{contact.phone}
          </p>
        )}
      </div>

      {/* Procedures */}
      {(contact.procedure_interest ?? []).length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {(contact.procedure_interest ?? []).slice(0, 2).map((p) => (
            <Badge key={p} variant="secondary" className="text-xs">{formatProcedure(p)}</Badge>
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="mt-2 flex items-center justify-between">
        <p className="text-xs text-gray-400">
          {contact.last_activity_at ? formatRelative(contact.last_activity_at) : '—'}
        </p>
      </div>
    </div>
  )
}

export function PipelineBoard({ columns, onStageChange }: PipelineBoardProps) {
  const allStages = columns.map((c) => ({ id: c.stage.id, name: c.stage.name }))

  return (
    <div className="flex h-full gap-4 overflow-x-auto pb-4">
      {columns.map((column) => (
        <div
          key={column.stage.id}
          className="flex w-64 flex-none flex-col rounded-xl border border-gray-200 bg-gray-50"
        >
          {/* Column header */}
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-gray-200">
            <div className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: column.stage.color }}
              />
              <h3 className="text-sm font-semibold text-gray-700">{column.stage.name}</h3>
            </div>
            <span className="text-xs text-gray-400 font-medium">{column.count}</span>
          </div>

          {/* Cards */}
          <div className="flex-1 overflow-y-auto p-2 space-y-2">
            {column.contacts.length === 0 && (
              <p className="py-6 text-center text-xs text-gray-400">Empty</p>
            )}
            {column.contacts.map((contact) => (
              <ContactCard
                key={contact.id}
                contact={contact}
                onMove={(stageId) => onStageChange(contact.id, stageId)}
                stages={allStages}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
