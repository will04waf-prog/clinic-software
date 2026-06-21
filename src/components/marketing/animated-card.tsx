'use client'

import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'

type Props = {
  children: ReactNode
  /** Per-card stagger index. Multiplied by 100ms and applied via --stagger.
   *  Touch CSS overrides --stagger to 0 so phones don't cascade. */
  index?: number
  className?: string
}

/**
 * Per-card entrance — IntersectionObserver + CSS transition, matching
 * AnimatedSection. See animated-section.tsx for the rationale on moving
 * off Framer Motion. The only difference here is the stagger index, which
 * drives a CSS variable so multi-column grids get a cascading entrance
 * on desktop and a synchronized one on touch.
 */
export function AnimatedCard({ children, index = 0, className }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

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

  const style: CSSProperties | undefined =
    index > 0 ? ({ '--stagger': `${index * 100}ms` } as CSSProperties) : undefined

  return (
    <div
      ref={ref}
      data-visible={visible ? 'true' : undefined}
      style={style}
      className={['marketing-fade-up', className].filter(Boolean).join(' ')}
    >
      {children}
    </div>
  )
}
