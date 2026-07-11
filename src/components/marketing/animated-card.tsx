'use client'

import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { motion, useMotionValue, useReducedMotion, useSpring } from 'framer-motion'

type Props = {
  children: ReactNode
  /** Per-card stagger index. Multiplied by 100ms and applied via --stagger.
   *  Touch CSS overrides --stagger to 0 so phones don't cascade. */
  index?: number
  className?: string
  /** Subtle 3D tilt-toward-cursor on hover (Spline floating-glass-card
   *  language). Fine-pointer hover devices only; reduced motion and touch
   *  never tilt. Defaults on — every current importer is a marketing
   *  surface. Pass false if a non-marketing screen ever adopts this card. */
  tilt?: boolean
}

/** Max tilt in degrees — ±4° reads as depth, not a toy. */
const MAX_TILT_DEG = 4
const TILT_SPRING = { stiffness: 260, damping: 24 } as const

/**
 * Per-card entrance — IntersectionObserver + CSS transition, matching
 * AnimatedSection. See animated-section.tsx for the rationale on moving
 * off Framer Motion. The only difference here is the stagger index, which
 * drives a CSS variable so multi-column grids get a cascading entrance
 * on desktop and a synchronized one on touch.
 *
 * Tilt lives on a SEPARATE outer motion.div, not the styled card div:
 * .marketing-fade-up owns (and transitions) `transform` on the inner
 * element, and callers pass hover -translate-y / shadow classes there
 * too — so Framer owning the same element's transform would clobber the
 * entrance and fight the hover lift. On its own wrapper, the spring
 * rotation composes with both instead. The wrapper is `display: grid`
 * so the card keeps stretching to full row height inside grid layouts.
 * Like MagneticCta, the pointermove listener attaches on pointerenter
 * and detaches on pointerleave — zero idle cost.
 */
export function AnimatedCard({ children, index = 0, className, tilt = true }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const reduced = useReducedMotion()

  // Rect is cached on enter — the wrapper is the element being rotated,
  // so re-measuring it per move would read back its own transform.
  const rectRef = useRef<DOMRect | null>(null)
  const rotateX = useMotionValue(0)
  const rotateY = useMotionValue(0)
  const springRotateX = useSpring(rotateX, TILT_SPRING)
  const springRotateY = useSpring(rotateY, TILT_SPRING)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisible(true)
          obs.disconnect()
        }
      },
      { rootMargin: '0px 0px -15% 0px' },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  const handlePointerEnter = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!tilt || reduced) return
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return
    const wrapper = event.currentTarget
    rectRef.current = wrapper.getBoundingClientRect()
    const onMove = (e: PointerEvent) => {
      const rect = rectRef.current
      if (!rect) return
      // Cursor offset from center, normalized to the half-extent, so the
      // full ±4° is only reached at the card's edges.
      const nx = (e.clientX - rect.left - rect.width / 2) / (rect.width / 2)
      const ny = (e.clientY - rect.top - rect.height / 2) / (rect.height / 2)
      rotateX.set(Math.max(-1, Math.min(1, -ny)) * MAX_TILT_DEG)
      rotateY.set(Math.max(-1, Math.min(1, nx)) * MAX_TILT_DEG)
    }
    const onLeave = () => {
      wrapper.removeEventListener('pointermove', onMove)
      rectRef.current = null
      rotateX.set(0)
      rotateY.set(0)
    }
    wrapper.addEventListener('pointermove', onMove)
    wrapper.addEventListener('pointerleave', onLeave, { once: true })
  }

  const style: CSSProperties | undefined =
    index > 0 ? ({ '--stagger': `${index * 100}ms` } as CSSProperties) : undefined

  return (
    <motion.div
      onPointerEnter={handlePointerEnter}
      style={{ rotateX: springRotateX, rotateY: springRotateY, transformPerspective: 900 }}
      className="grid"
    >
      <div
        ref={ref}
        data-visible={visible ? 'true' : undefined}
        style={style}
        className={['marketing-fade-up', className].filter(Boolean).join(' ')}
      >
        {children}
      </div>
    </motion.div>
  )
}
