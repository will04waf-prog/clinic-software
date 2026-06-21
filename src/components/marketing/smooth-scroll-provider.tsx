'use client'

import { useEffect } from 'react'
import Lenis from 'lenis'
import { MotionConfig } from 'framer-motion'
import { useIsTouchDevice } from './use-is-touch-device'

/**
 * SmoothScrollProvider — momentum scrolling for desktop wheel input.
 *
 * Touch devices skip Lenis entirely. iOS Safari and modern Android Chrome
 * run scroll on the compositor thread with GPU-accelerated momentum physics
 * that a JS RAF loop cannot match. Lenis on mobile fights the platform
 * instead of helping it.
 *
 * The wrapping <MotionConfig reducedMotion="user"> propagates
 * prefers-reduced-motion to every Framer Motion component in the landing
 * page, so reduce-motion users get static entrances without each component
 * having to opt in.
 */
export function SmoothScrollProvider({ children }: { children: React.ReactNode }) {
  const isTouch = useIsTouchDevice()

  useEffect(() => {
    // Skip on touch devices — native scroll is smoother on phones/tablets.
    if (isTouch) return

    // Honor reduced-motion: skip smooth scroll entirely for these users.
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
  }, [isTouch])

  return <MotionConfig reducedMotion="user">{children}</MotionConfig>
}
