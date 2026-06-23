import { cn } from '@/lib/utils'

/**
 * "All / Unread / Booked" filter pills above the inbox list, matching
 * the mockup. Selected chip is a solid navy pill with white text;
 * unselected are white outlines with dark text.
 *
 * Filter values are deliberately distinct from the previous Tabs
 * statuses (lead/patient/inactive) — the inbox is messaging-focused,
 * not pipeline-status-focused, so this chip-bar replaces the Tabs only
 * on /leads. /leads/[id] is unaffected.
 */

export type InboxFilter = 'all' | 'unread' | 'booked'

interface Props {
  value: InboxFilter
  onChange: (v: InboxFilter) => void
  unreadCount: number
  bookedCount: number
}

const FILTERS: { key: InboxFilter; label: string }[] = [
  { key: 'all',    label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'booked', label: 'Booked' },
]

export function InboxFilterChips({ value, onChange, unreadCount, bookedCount }: Props) {
  const count: Record<InboxFilter, number | null> = {
    all:    null,
    unread: unreadCount,
    booked: bookedCount,
  }
  return (
    <div className="flex items-center gap-2">
      {FILTERS.map(({ key, label }) => {
        const active = value === key
        const n = count[key]
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12.5px] font-medium transition-colors',
              active
                ? 'bg-[#0B2027] text-[#FAF6EC]'
                : 'bg-white text-[#0B2027]/75 border border-[#0B2027]/12 hover:bg-[#0B2027]/4',
            )}
          >
            {label}
            {n !== null && n > 0 && (
              <span
                className={cn(
                  'inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold',
                  active ? 'bg-[#FAF6EC]/15 text-[#FAF6EC]' : 'bg-[#02C39A]/15 text-[#028090]',
                )}
              >
                {n}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
