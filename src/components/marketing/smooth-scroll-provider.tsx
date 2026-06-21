'use client'

import { useEffect } from 'react'
import Lenis from 'lenis'

/**
 * SmoothScrollProvider — adds buttery momentum scrolling site-wide.
 *
 * Inspired by the weighted, premium scroll feel of sites like igloo.inc,
 * tuned to be subtle and professional rather than dramatic.
 *
 * Respects `prefers-reduced-motion`: users who opt out get native scroll,
 * so accessibility is never compromised.
 */
export function SmoothScrollProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // Honor reduced-motion — skip smooth scroll entirely for these users.
    const prefersReduced = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches
    if (prefersReduced) return

    const lenis = new Lenis({
      // Slightly longer duration + gentle easing = the "weighted glide" feel.
      duration: 1.1,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)), // expo-out
      smoothWheel: true,
      wheelMultiplier: 1,
      touchMultiplier: 1.5,
    })

    let rafId: number
    function raf(time: number) {
      lenis.raf(time)
      rafId = requestAnimationFrame(raf)
    }
    rafId = requestAnimationFrame(raf)

    return () => {
      cancelAnimationFrame(rafId)
      lenis.destroy()
    }
  }, [])

  return <>{children}</>
}
