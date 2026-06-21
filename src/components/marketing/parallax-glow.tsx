'use client'

import { motion, useScroll, useTransform } from 'framer-motion'

/**
 * ParallaxGlow — the hero's mint aura, but it drifts slowly as you scroll,
 * giving the section a sense of depth (igloo-inspired, kept very subtle).
 *
 * Tracks the document scroll directly (no target ref) so it never triggers
 * Framer Motion's "container needs non-static position" warning.
 *
 * Framer Motion automatically respects `prefers-reduced-motion`, so this is
 * accessibility-safe.
 */
export function ParallaxGlow() {
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
