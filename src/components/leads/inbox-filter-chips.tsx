import { Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * "All / Unread / Booked / AI ready" filter pills above the inbox
 * list, matching the mockup. Selected chip is a solid navy pill
 * with white text; unselected are white outlines with dark text.
 * The AI ready chip flips to mint when active so the surface
 * matches the Sparkles indicator on the row itself — the inbox has
 * exactly one mint affordance per row, and it stays mint when
 * filtered.
 *
 * Filter values are deliberately distinct from the previous Tabs
 * statuses (lead/patient/inactive) — the inbox is messaging-focused,
 * not pipeline-status-focused, so this chip-bar replaces the Tabs only
 * on /leads. /leads/[id] is unaffected.
 */

export type InboxFilter = 'all' | 'unread' | 'booked' | 'ai_ready'

interface Props {
  value: InboxFilter
  onChange: (v: InboxFilter) => void
  unreadCount: number
  bookedCount: number
  aiReadyCount: number
}

const FILTERS: { key: InboxFilter; label: string }[] = [
  { key: 'all',      label: 'All' },
  { key: 'unread',   label: 'Unread' },
  { key: 'booked',   label: 'Booked' },
  { key: 'ai_ready', label: 'AI ready' },
]

export function InboxFilterChips({
  value,
  onChange,
  unreadCount,
  bookedCount,
  aiReadyCount,
}: Props) {
  const count: Record<InboxFilter, number | null> = {
    all:      null,
    unread:   unreadCount,
    booked:   bookedCount,
    ai_ready: aiReadyCount,
  }
  return (
    <div className="flex items-center gap-2">
      {FILTERS.map(({ key, label }) => {
        const active = value === key
        const n = count[key]
        const isAiReady = key === 'ai_ready'
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12.5px] font-medium transition-colors',
              active
                ? isAiReady
                  ? 'bg-[#02C39A] text-white'
                  : 'bg-[#0B2027] text-[#FAF6EC]'
                : 'bg-white text-[#0B2027]/75 border border-[#0B2027]/12 hover:bg-[#0B2027]/4',
            )}
          >
            {isAiReady && active && (
              <Sparkles
                className="h-3 w-3 -ml-0.5 mr-0.5"
                fill="currentColor"
                aria-hidden="true"
              />
            )}
            {label}
            {n !== null && n > 0 && (
              <span
                className={cn(
                  'inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold',
                  active
                    ? isAiReady
                      ? 'bg-white/20 text-white'
                      : 'bg-[#FAF6EC]/15 text-[#FAF6EC]'
                    : 'bg-[#02C39A]/15 text-[#028090]',
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
