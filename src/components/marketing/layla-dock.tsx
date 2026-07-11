'use client'

import { Fragment, useEffect, useRef, useState } from 'react'
import { useReducedMotion } from 'framer-motion'
import { ArrowRight, CalendarCheck, LayoutGrid, MessageSquareText, PhoneCall } from 'lucide-react'

/**
 * LaylaDock — a floating glassmorphic pill showing Layla's pipeline at
 * a glance (Spline floating-dock tile, adapted). Four icon+label chips
 * — Answers → Books → Texts → Logs to CRM — light up in sequence with
 * a mint fill and a slight scale pop, echoing how the Spline dock
 * highlights icons, while the pill itself idles on a slow float.
 *
 * Decorative garnish, not a nav: it repeats the adjacent copy, so the
 * whole pill is aria-hidden and non-interactive.
 *
 * Battery + a11y (same gating discipline as BilingualRoll): the chip
 * sequence only advances while the dock is on screen (IO) AND the tab
 * is visible (visibilitychange); the float is CSS, keyed off the same
 * data-floating attribute. Reduced motion renders every chip lit,
 * static — the pipeline still reads without any movement.
 */

const CHIPS = [
  { icon: PhoneCall, label: 'Answers', short: 'Answers' },
  { icon: CalendarCheck, label: 'Books', short: 'Books' },
  { icon: MessageSquareText, label: 'Texts', short: 'Texts' },
  { icon: LayoutGrid, label: 'Logs to CRM', short: 'Logs' },
] as const

const STEP_MS = 900
const LOOP_PAUSE_MS = 1700

export function LaylaDock() {
  const reduced = useReducedMotion()
  const ref = useRef<HTMLDivElement>(null)
  const [inView, setInView] = useState(false)
  const [pageVisible, setPageVisible] = useState(true)
  const [active, setActive] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { threshold: 0.4 },
    )
    io.observe(el)
    const onVisibility = () => setPageVisible(document.visibilityState === 'visible')
    onVisibility()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      io.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  // Advance one chip per step; hold a longer beat after the last chip so
  // each loop reads as a completed pipeline, not a spinner.
  useEffect(() => {
    if (reduced || !inView || !pageVisible) return
    const id = window.setTimeout(
      () => setActive((a) => (a + 1) % CHIPS.length),
      active === CHIPS.length - 1 ? LOOP_PAUSE_MS : STEP_MS,
    )
    return () => window.clearTimeout(id)
  }, [active, inView, pageVisible, reduced])

  return (
    <div
      ref={ref}
      aria-hidden="true"
      data-floating={!reduced && inView && pageVisible ? 'true' : undefined}
      className="layla-dock inline-flex max-w-full items-center gap-0.5 rounded-full border border-white/70 bg-white/55 px-2.5 py-2 shadow-[0_12px_40px_-12px_rgba(11,32,39,0.28)] backdrop-blur-md sm:gap-1 sm:px-4"
    >
      {CHIPS.map(({ icon: Icon, label, short }, i) => {
        const lit = reduced || i === active
        return (
          <Fragment key={label}>
            {i > 0 && <ArrowRight className="h-3 w-3 shrink-0 text-[#14241d]/25" />}
            <span
              data-lit={lit ? 'true' : undefined}
              className={`layla-dock-chip flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-1.5 text-[11px] font-semibold tracking-tight sm:px-2.5 sm:text-xs ${
                lit ? 'bg-[#02C39A]/15 text-[#026B78]' : 'text-gray-500'
              }`}
            >
              <Icon className={`h-3.5 w-3.5 shrink-0 ${lit ? 'text-[#02C39A]' : 'text-gray-400'}`} />
              <span className="sm:hidden">{short}</span>
              <span className="hidden sm:inline">{label}</span>
            </span>
          </Fragment>
        )
      })}
    </div>
  )
}
