'use client'

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

type Props = {
  /** The existing FAQ <details> list — rendered unchanged. */
  children: ReactNode
}

/**
 * FAQ momentum CTA — wraps the FAQ <details> list and watches how the
 * visitor reads it.
 *
 * Opening one question is idle curiosity; opening a SECOND distinct
 * question is the signature of a serious evaluator working through
 * objections. At that moment — once, permanently for the session — a
 * slim call-to-action row rises in below the list pointing at the live
 * demo line, so the answer to "still deciding?" is Layla's own voice.
 *
 * Implementation: <details> `toggle` events do NOT bubble, so a normal
 * React onToggle on the wrapper never fires. Instead we attach a native
 * capture-phase listener to the wrapper div — capture descends through
 * the wrapper on the way to the target, so every child <details> is
 * observed without touching the children's markup. Distinct opens are
 * tracked in a Set of elements (re-opening the same question twice
 * doesn't count as momentum).
 *
 * The reveal uses the existing `.rise` utility (globals.css), which is
 * already disabled under prefers-reduced-motion; the pulsing dot uses
 * Tailwind's motion-safe variant for the same guarantee. SSR-safe: the
 * row only ever appears after client-side interaction, so server markup
 * always equals the first client render.
 */
export function FaqMomentum({ children }: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const openedRef = useRef<Set<HTMLDetailsElement>>(new Set())
  const [revealed, setRevealed] = useState(false)

  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return

    const handleToggle = (event: Event) => {
      const details = event.target
      if (!(details instanceof HTMLDetailsElement) || !details.open) return
      openedRef.current.add(details)
      if (openedRef.current.size >= 2) setRevealed(true)
    }

    // 'toggle' doesn't bubble — capture phase still passes through the
    // wrapper on the way down to each <details>.
    wrapper.addEventListener('toggle', handleToggle, true)
    return () => wrapper.removeEventListener('toggle', handleToggle, true)
  }, [])

  return (
    <div ref={wrapperRef}>
      {children}
      {revealed && (
        <div className="rise mt-4 flex flex-wrap items-center justify-center gap-2 rounded-xl border border-[#02C39A]/30 bg-[#02C39A]/5 px-5 py-3.5 text-sm text-gray-700">
          <span aria-hidden="true" className="relative flex h-2 w-2 shrink-0">
            <span className="absolute inline-flex h-full w-full rounded-full bg-[#02C39A]/50 motion-safe:animate-ping [animation-duration:2.2s]" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-[#02C39A]" />
          </span>
          <span>Still deciding? Ask her yourself&nbsp;&mdash;</span>
          {/* py-3/-my-3 stretches the tap target to ~44px without
              changing the row's visual height. */}
          <a
            href="tel:+13019622856"
            aria-label="Call the live demo line at (301) 962-2856 — Layla answers"
            className="-my-3 whitespace-nowrap rounded-md px-1 py-3 font-semibold text-[#026B78] underline-offset-4 transition-colors hover:text-[#028090] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#028090]"
          >
            (301) 962-2856
          </a>
        </div>
      )}
    </div>
  )
}
