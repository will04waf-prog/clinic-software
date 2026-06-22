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
  // Dedupe procedure_interest (data sometimes lands with the same procedure
  // twice — e.g. Marcus Johnson with two Body Contouring chips) so the
  // visible card never shows a duplicate badge.
  const procedures = Array.from(new Set(contact.procedure_interest ?? []))

  const body = (
    <>
      <p className="font-semibold text-sm text-[#14241d] leading-tight group-hover:text-[#14241d]/80 transition-colors">
        {contact.first_name} {contact.last_name}
      </p>
      {(contact.email || contact.phone) && (
        <div className="mt-2 space-y-1">
          {contact.email && (
            <p className="flex items-center gap-1.5 text-xs text-gray-500 truncate">
              <Mail className="h-3 w-3 shrink-0 text-gray-300" />
              <span className="truncate">{contact.email}</span>
            </p>
          )}
          {contact.phone && (
            <p className="flex items-center gap-1.5 text-xs text-gray-500">
              <Phone className="h-3 w-3 shrink-0 text-gray-300" />
              {contact.phone}
            </p>
          )}
        </div>
      )}
      {procedures.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1">
          {procedures.slice(0, 2).map((p) => (
            <span
              key={p}
              className="rounded-full bg-[#02C39A]/15 px-1.5 py-0 text-[10px] font-medium text-[#02C39A]"
            >
              {formatProcedure(p)}
            </span>
          ))}
          {procedures.length > 2 && (
            <span className="rounded-full bg-gray-100 px-1.5 py-0 text-[10px] font-medium text-gray-600">
              +{procedures.length - 2}
            </span>
          )}
        </div>
      )}
      {contact.last_activity_at && (
        <p className="mt-2.5 text-[10px] text-gray-400 uppercase tracking-wide">
          {formatRelative(contact.last_activity_at)}
        </p>
      )}
    </>
  )

  // Forest cards on mint-tinted columns — same role as the landing page's
  // dark anchor panels inside lighter sections. The shadow alone provides
  // separation; during drag we add a mint ring + rotation so the floating
  // overlay reads as a distinct visual layer.
  const wrapperClass = [
    'group block rounded-lg bg-white p-3 transition-all duration-150',
    elevated
      ? 'shadow-[0_10px_24px_-12px_rgba(20,36,29,0.5)] ring-1 ring-[#02C39A]/40 -rotate-1'
      : 'shadow-[0_1px_2px_rgba(20,36,29,0.12),0_1px_3px_rgba(20,36,29,0.08)] hover:shadow-[0_2px_8px_rgba(20,36,29,0.16),0_4px_16px_rgba(20,36,29,0.10)] hover:-translate-y-0.5',
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
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className="touch-none cursor-grab active:cursor-grabbing"
    >
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
        // Column bg picks up a soft mint tint so the kanban harmonizes with
        // the cream body + forest sidebar instead of falling into cool-gray.
        'flex w-72 flex-none flex-col rounded-2xl bg-[#02C39A]/[0.06] transition-colors duration-200',
        isOver ? 'bg-[#02C39A]/15 ring-2 ring-[#02C39A]/40' : 'ring-1 ring-[#14241d]/10',
      ].join(' ')}
    >
      {/* Column header — pulled into the column bg, no divider line. The
          stage-color dot reads as the accent; rest stays neutral. */}
      <div className="flex items-center justify-between px-3.5 pt-3 pb-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="h-2 w-2 rounded-full shrink-0"
            style={{ backgroundColor: column.stage.color }}
          />
          <h3 className="text-[11px] font-semibold text-[#14241d]/75 uppercase tracking-wider truncate">
            {column.stage.name}
          </h3>
          <span className="text-[11px] font-semibold text-[#14241d]/55 tabular-nums">
            {column.count}
          </span>
        </div>
      </div>
      {/* Card list — uniform vertical rhythm, padded so cards don't hug
          the column edges. min-h keeps an empty column dropping-friendly. */}
      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-2 min-h-[8rem]">
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
              <div className="flex items-center justify-center rounded-lg border border-dashed border-[#14241d]/15 py-8 mx-1 mt-1">
                <p className="text-[11px] text-[#14241d]/45 italic">Drop here</p>
              </div>
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
