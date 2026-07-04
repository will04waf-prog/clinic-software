'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * A number that counts up on first render and TICKS to new values on
 * change (the dashboard polls every 60s — data should glide, not
 * teleport). Ease-out cubic over ~600ms; respects reduced motion.
 *
 * Pass `format` for display (e.g. money): it receives the in-flight
 * integer each frame. Wrap usages in tabular-nums containers so digits
 * don't jitter horizontally while counting.
 */
export function AnimatedNumber({
  value,
  format = (n) => n.toLocaleString(),
  durationMs = 600,
}: {
  value: number
  format?: (n: number) => string
  durationMs?: number
}) {
  const [display, setDisplay] = useState(0)
  const fromRef = useRef(0)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (typeof window !== 'undefined' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      fromRef.current = value
      setDisplay(value)
      return
    }
    const from = fromRef.current
    if (from === value) { setDisplay(value); return }
    const t0 = performance.now()
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / durationMs)
      const eased = 1 - Math.pow(1 - k, 3)
      setDisplay(Math.round(from + (value - from) * eased))
      if (k < 1) rafRef.current = requestAnimationFrame(tick)
      else fromRef.current = value
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [value, durationMs])

  return <>{format(display)}</>
}
