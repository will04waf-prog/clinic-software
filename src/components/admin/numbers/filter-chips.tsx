'use client'

/**
 * Phase 5 M6 — filter chips for /admin/numbers.
 *
 * Renders a row of pill-shaped buttons that read/write the ?filter=
 * search param. We use a client component (not a server component
 * with Link) so the chips can preserve any other search params on
 * the page if the dashboard grows additional axes (search, sort).
 *
 * The actual filtering happens server-side in page.tsx — this is
 * purely a navigation surface. The active chip is computed against
 * useSearchParams() so back/forward keep the highlight in sync with
 * the URL.
 */

import { useRouter, useSearchParams } from 'next/navigation'
import { cn } from '@/lib/utils'

export type NumberHealthFilter =
  | 'all'
  | 'healthy'
  | 'pending'
  | 'a2p_pending'
  | 'a2p_failed'
  | 'stale'
  | 'missing_vapi'

const CHIPS: Array<{ value: NumberHealthFilter; label: string }> = [
  { value: 'all',          label: 'All'                  },
  { value: 'healthy',      label: 'Healthy'              },
  { value: 'pending',      label: 'Pending provisioning' },
  { value: 'a2p_pending',  label: 'A2P pending'          },
  { value: 'a2p_failed',   label: 'A2P failed'           },
  { value: 'stale',        label: 'Stale'                },
  { value: 'missing_vapi', label: 'Missing Vapi binding' },
]

export function FilterChips({ counts }: { counts: Record<NumberHealthFilter, number> }) {
  const router = useRouter()
  const params = useSearchParams()
  const active = (params.get('filter') as NumberHealthFilter | null) ?? 'all'

  function setFilter(next: NumberHealthFilter) {
    const sp = new URLSearchParams(params.toString())
    if (next === 'all') sp.delete('filter')
    else sp.set('filter', next)
    const query = sp.toString()
    router.push(`/admin/numbers${query ? `?${query}` : ''}`)
  }

  return (
    <div className="flex flex-wrap gap-2">
      {CHIPS.map(({ value, label }) => {
        const isActive = active === value
        const count = counts[value] ?? 0
        return (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors',
              isActive
                ? 'bg-brand-600 text-white'
                : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50',
            )}
          >
            <span>{label}</span>
            <span
              className={cn(
                'inline-flex items-center justify-center rounded-full px-1.5 text-[10px] font-semibold',
                isActive ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500',
              )}
            >
              {count}
            </span>
          </button>
        )
      })}
    </div>
  )
}
