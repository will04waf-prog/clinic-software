'use client'

import { useEffect, useState } from 'react'
import { motion, useScroll, useTransform } from 'framer-motion'
import { useIsTouchDevice } from './use-is-touch-device'

/**
 * ParallaxGlow — the hero's mint aura.
 *
 * Desktop: drifts slowly as the user scrolls (igloo-inspired), giving the
 * hero section depth without distraction.
 *
 * Touch devices: a static glow. The scroll-linked transform is the single
 * most expensive scroll-time work on mobile and the parallax effect is too
 * subtle to be worth the jank. Skipping `useScroll` entirely also avoids
 * attaching a scroll listener on the page's busiest section.
 *
 * The `mounted` gate ensures SSR and first-paint always render the static
 * variant — the desktop scroll listener only attaches after hydration on
 * non-touch devices, so we never get a brief attach-then-detach on phones.
 */
export function ParallaxGlow() {
  const isTouch = useIsTouchDevice()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted || isTouch) {
    return <div className="hero-glow" aria-hidden="true" />
  }
  return <DesktopParallaxGlow />
}

function DesktopParallaxGlow() {
  const { scrollY } = useScroll()

  // Over the first ~700px of scroll (the hero region), the glow drifts down,
  // grows slightly, and fades — adding depth without distraction.
  const y = useTransform(scrollY, [0, 700], ['0%', '30%'])
  const opacity = useTransform(scrollY, [0, 700], [1, 0.2])
  const scale = useTransform(scrollY, [0, 700], [1, 1.15])

  return (
    <motion.div
      className="hero-glow"
      style={{ y, opacity, scale }}
      aria-hidden="true"
    />
  )
}
