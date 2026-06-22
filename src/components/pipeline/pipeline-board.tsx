'use client'
import { useState } from 'react'
import Link from 'next/link'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import { Mail, Phone } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { formatRelative, formatProcedure } from '@/lib/utils'
import type { PipelineColumn, PipelineContact } from '@/types'

interface PipelineBoardProps {
  columns: PipelineColumn[]
  onStageChange: (contactId: string, stageId: string) => void
}

/**
 * Card visual — no drag wiring here so the same component renders both
 * the in-column card AND the floating overlay while dragging.
 */
function ContactCardVisual({
  contact,
  asLink = true,
  dimmed = false,
  elevated = false,
}: {
  contact: PipelineContact
  asLink?: boolean
  dimmed?: boolean
  elevated?: boolean
}) {
  const body = (
    <>
      <p className="font-medium text-sm text-gray-900 group-hover:text-brand-600">
        {contact.first_name} {contact.last_name}
      </p>
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
      {(contact.procedure_interest ?? []).length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {(contact.procedure_interest ?? []).slice(0, 2).map((p) => (
            <Badge key={p} variant="secondary" className="text-xs">{formatProcedure(p)}</Badge>
          ))}
        </div>
      )}
      <div className="mt-2 flex items-center justify-between">
        <p className="text-xs text-gray-400">
          {contact.last_activity_at ? formatRelative(contact.last_activity_at) : '—'}
        </p>
      </div>
    </>
  )

  const wrapperClass = [
    'group rounded-lg border border-gray-200 bg-white p-3 transition-shadow',
    elevated ? 'shadow-lg ring-1 ring-brand-500/20' : 'shadow-sm hover:shadow-md',
    dimmed ? 'opacity-30' : '',
  ].filter(Boolean).join(' ')

  if (asLink) {
    return (
      <Link href={`/leads/${contact.id}`} className={wrapperClass}>
        {body}
      </Link>
    )
  }
  return <div className={wrapperClass}>{body}</div>
}

/**
 * Draggable wrapper. Pointer sensor's activation distance (5px) means a
 * click without movement falls through to the <Link> in ContactCardVisual,
 * preserving "tap card to open detail" while still allowing drag.
 */
function DraggableCard({ contact }: { contact: PipelineContact }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: contact.id,
    data: { contact },
  })
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} className="touch-none">
      <ContactCardVisual contact={contact} dimmed={isDragging} />
    </div>
  )
}

/**
 * Droppable column. isOver lights up the column header so the drop target
 * is obvious during the drag.
 */
function DroppableColumn({
  column,
  children,
}: {
  column: PipelineColumn
  children: React.ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.stage.id })
  return (
    <div
      ref={setNodeRef}
      className={[
        'flex w-64 flex-none flex-col rounded-xl border bg-gray-50 transition-colors',
        isOver ? 'border-brand-500 bg-brand-50/60' : 'border-gray-200',
      ].join(' ')}
    >
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
      <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-[6rem]">
        {children}
      </div>
    </div>
  )
}

export function PipelineBoard({ columns, onStageChange }: PipelineBoardProps) {
  const [activeContact, setActiveContact] = useState<PipelineContact | null>(null)

  // PointerSensor with a 5px activation distance lets clicks fall through
  // to the Link (so tapping a card still opens the lead detail). TouchSensor
  // gets a 200ms press delay so tapping doesn't accidentally trigger drag.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  )

  function handleDragStart(event: DragStartEvent) {
    const c = (event.active.data.current as { contact?: PipelineContact } | undefined)?.contact
    setActiveContact(c ?? null)
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveContact(null)
    const { active, over } = event
    if (!over) return
    const contactId = String(active.id)
    const targetStageId = String(over.id)
    const sourceStageId = columns.find(c => c.contacts.some(x => x.id === contactId))?.stage.id
    if (!sourceStageId || sourceStageId === targetStageId) return
    onStageChange(contactId, targetStageId)
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveContact(null)}
    >
      <div className="flex h-full gap-4 overflow-x-auto pb-4">
        {columns.map((column) => (
          <DroppableColumn key={column.stage.id} column={column}>
            {column.contacts.length === 0 && (
              <p className="py-6 text-center text-xs text-gray-400">Drop here</p>
            )}
            {column.contacts.map((contact) => (
              <DraggableCard key={contact.id} contact={contact} />
            ))}
          </DroppableColumn>
        ))}
      </div>

      <DragOverlay dropAnimation={null}>
        {activeContact ? (
          <ContactCardVisual contact={activeContact} asLink={false} elevated />
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
