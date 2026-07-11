'use client'

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { motion, useReducedMotion } from 'framer-motion'

/**
 * HeroEcho — one-time "motion-blur settle" on the hero's key phrase
 * (Spline "POWER" gallery tile, adapted).
 *
 * Two ghost copies of the phrase start offset, heavily blurred, and
 * converge into the crisp text while fading out — a single ~700ms
 * entrance, played once on load after the hero's existing .rise stagger.
 *
 * Accessibility + CLS guarantees:
 *  - The real phrase is plain server HTML in one contiguous node —
 *    screen readers read the headline normally and nothing is ever
 *    blurred if JS doesn't run.
 *  - Ghosts are client-only (rendered after mount), aria-hidden, and
 *    absolutely positioned over the phrase, so they reserve no space
 *    and can't shift layout.
 *  - prefers-reduced-motion mounts no ghosts at all.
 */

const GHOSTS = [
  { x: -18, blur: 7, opacity: 0.4 },
  { x: 14, blur: 5, opacity: 0.3 },
] as const

type Props = {
  children: ReactNode
  className?: string
  /** Seconds before the ghosts start converging — defaults tuned to land
   *  on the tail of the hero's .rise entrance. */
  delay?: number
}

export function HeroEcho({ children, className, delay = 0.35 }: Props) {
  const reduced = useReducedMotion()
  const [play, setPlay] = useState(false)

  // Ghosts only exist post-hydration, and never for reduced motion.
  useEffect(() => {
    if (reduced) return
    setPlay(true)
  }, [reduced])

  return (
    <span className={['relative inline-block', className].filter(Boolean).join(' ')}>
      <span className="relative z-10">{children}</span>
      {play &&
        GHOSTS.map(({ x, blur, opacity }) => (
          <motion.span
            key={x}
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-0 select-none"
            initial={{ opacity, x, filter: `blur(${blur}px)` }}
            animate={{ opacity: 0, x: 0, filter: 'blur(0px)' }}
            transition={{ duration: 0.7, delay, ease: [0.16, 1, 0.3, 1] }}
          >
            {children}
          </motion.span>
        ))}
    </span>
  )
}
