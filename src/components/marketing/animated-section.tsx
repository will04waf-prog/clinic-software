'use client'

import { motion } from 'framer-motion'
import type { ReactNode } from 'react'
import { useIsTouchDevice } from './use-is-touch-device'

type Props = {
  children: ReactNode
  delay?: number
  className?: string
}

/**
 * Fades + lifts the section in as it enters the viewport, once. Touch devices
 * get a shorter, smaller, snappier entrance because (a) sustained 0.8s fades
 * over 28px translate stack up under fast finger scroll, and (b) once-only is
 * the right behavior on phones anyway — re-triggering on reverse scroll feels
 * janky.
 */
export function AnimatedSection({ children, delay = 0, className }: Props) {
  const isTouch = useIsTouchDevice()

  const initialY = isTouch ? 12 : 28
  const duration = isTouch ? 0.35 : 0.8
  const margin = isTouch ? '-40px' : '-80px'
  // Stagger delays only fire on desktop. On touch each section enters when it
  // crosses the threshold; no need to add wait time.
  const effectiveDelay = isTouch ? 0 : delay

  return (
    <motion.div
      initial={{ opacity: 0, y: initialY }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin }}
      transition={{ duration, delay: effectiveDelay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  )
}
