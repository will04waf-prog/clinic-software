'use client'

import { useEffect, useState } from 'react'

/**
 * Returns true on devices whose primary input is touch (no hover, coarse
 * pointer). Used to skip JS-heavy scroll effects — Lenis smooth scroll and
 * scroll-linked transforms — on phones and tablets, since native compositor
 * scroll is significantly smoother than anything we can replicate via RAF.
 *
 * SSR-safe: returns `false` during server render and first client paint, then
 * updates to the real value after mount. Components that need to AVOID
 * rendering scroll-listener machinery on touch devices should gate that path
 * on a `mounted` boolean to avoid a brief listener attach-then-detach on the
 * mobile first frame.
 */
export function useIsTouchDevice(): boolean {
  const [isTouch, setIsTouch] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(hover: none) and (pointer: coarse)')
    setIsTouch(mq.matches)
    const handler = (e: MediaQueryListEvent) => setIsTouch(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  return isTouch
}
