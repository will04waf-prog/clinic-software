'use client'

import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'

type Props = {
  children: ReactNode
  /** Delay in seconds before the entrance starts. Set as the --stagger CSS
   *  variable; ignored on touch devices (handled in CSS). */
  delay?: number
  className?: string
}

/**
 * Fades + lifts the section in as it enters the viewport, once.
 *
 * Implementation: IntersectionObserver flips data-visible, a CSS transition
 * on opacity + translate3d handles the actual animation. Running on the
 * compositor thread means the entrance stays smooth even under main-thread
 * pressure — crucial on mobile, where Framer Motion's JS-driven animations
 * stutter under fast finger scroll.
 */
export function AnimatedSection({ children, delay = 0, className }: Props) {
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
    delay > 0 ? ({ '--stagger': `${delay * 1000}ms` } as CSSProperties) : undefined

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
