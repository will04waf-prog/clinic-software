'use client'

import type { ReactNode } from 'react'
import {
  MotionConfig, motion, useMotionValue, useReducedMotion, useSpring,
} from 'framer-motion'

type Props = {
  children: ReactNode
  /** Layout classes for the wrapper (e.g. `w-full sm:w-auto` so the
   *  child link's own w-full keeps working on mobile). */
  className?: string
}

/** The pull never exceeds ±6px: at that range the CTA reads as attentive —
 *  it leans toward the cursor, then settles — without ever chasing it.
 *  Restraint IS the brand (premium spa calm); a bigger radius turns the
 *  button into a toy. */
const MAX_PULL = 6
const SPRING = { stiffness: 300, damping: 22 } as const

/**
 * Magnetic-spring wrapper for the landing page's gradient CTA links.
 *
 * Hover physics run only on hover-capable fine-pointer devices with no
 * reduced-motion preference, and the pointermove listener is attached on
 * pointerenter / removed on pointerleave — zero idle cost. Transform-only:
 * we measure the static outer wrapper (never the moving child), so there
 * are no layout writes and no measurement feedback loops. whileTap press
 * feedback stays on for ALL devices, touch included; the local
 * MotionConfig reducedMotion="user" downgrades it to a discrete (non-
 * animated) press for users who prefer reduced motion.
 */
export function MagneticCta({ children, className }: Props) {
  const prefersReducedMotion = useReducedMotion()
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const springX = useSpring(x, SPRING)
  const springY = useSpring(y, SPRING)

  const handlePointerEnter = (event: React.PointerEvent<HTMLDivElement>) => {
    if (prefersReducedMotion) return
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return
    const wrapper = event.currentTarget
    const onMove = (e: PointerEvent) => {
      const rect = wrapper.getBoundingClientRect()
      // Cursor offset from center, normalized to the half-extent, so the
      // full ±6px is only reached at the wrapper's edges.
      const nx = (e.clientX - rect.left - rect.width / 2) / (rect.width / 2)
      const ny = (e.clientY - rect.top - rect.height / 2) / (rect.height / 2)
      x.set(Math.max(-MAX_PULL, Math.min(MAX_PULL, nx * MAX_PULL)))
      y.set(Math.max(-MAX_PULL, Math.min(MAX_PULL, ny * MAX_PULL)))
    }
    const onLeave = () => {
      wrapper.removeEventListener('pointermove', onMove)
      x.set(0)
      y.set(0)
    }
    wrapper.addEventListener('pointermove', onMove)
    wrapper.addEventListener('pointerleave', onLeave, { once: true })
  }

  return (
    <MotionConfig reducedMotion="user">
      <div
        onPointerEnter={handlePointerEnter}
        className={['inline-flex', className].filter(Boolean).join(' ')}
      >
        <motion.div
          style={{ x: springX, y: springY }}
          whileTap={{ scale: 0.965 }}
          className="flex w-full flex-1"
        >
          {children}
        </motion.div>
      </div>
    </MotionConfig>
  )
}
