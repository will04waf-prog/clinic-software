'use client'

import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'

/**
 * BlurUnveil — a line of text that resolves from a soft blur as a mint
 * highlight sweep passes over it (Spline "Relativity" unblur tile).
 *
 * Progressive enhancement, strictly ordered:
 *   server HTML  → plain, fully readable text (no blur anywhere)
 *   after mount  → only once IntersectionObserver support is confirmed
 *                  and the user hasn't asked for reduced motion is the
 *                  wrapper "armed" (blur snaps on, pre-viewport)
 *   on intersect → 'play' transitions the blur off and runs the sweep
 *
 * If JS or IO never runs the text is never blurred, and reduced-motion
 * users always see plain text. One-shot (no loop), so no visibility
 * gating is needed. Styles live in globals.css (.blur-unveil-*).
 */

type Props = {
  children: ReactNode
  /** Per-line stagger in ms — drives --bu-delay for both the unblur
   *  transition and the sweep animation. */
  delay?: number
  className?: string
}

export function BlurUnveil({ children, delay = 0, className }: Props) {
  const ref = useRef<HTMLSpanElement>(null)
  const [stage, setStage] = useState<'rest' | 'armed' | 'play'>('rest')

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (
      typeof IntersectionObserver === 'undefined' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return // stay at rest: plain readable text, forever
    }
    setStage('armed')
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setStage('play')
          obs.disconnect()
        }
      },
      { rootMargin: '0px 0px -12% 0px' },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  const style: CSSProperties | undefined =
    delay > 0 ? ({ '--bu-delay': `${delay}ms` } as CSSProperties) : undefined

  return (
    <span
      ref={ref}
      style={style}
      className={[
        'blur-unveil',
        stage === 'armed' ? 'blur-unveil-armed' : undefined,
        stage === 'play' ? 'blur-unveil-play' : undefined,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </span>
  )
}
