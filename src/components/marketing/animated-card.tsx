'use client'

import { motion } from 'framer-motion'
import type { ReactNode } from 'react'
import { useIsTouchDevice } from './use-is-touch-device'

type Props = {
  children: ReactNode
  index?: number
  className?: string
}

/**
 * Per-card entrance animation. Cards in a grid stagger on desktop for a
 * cascading effect, but on touch the stagger is dropped — phones render
 * grids as single columns, so cards enter the viewport one at a time
 * naturally as the user scrolls, and synthetic stagger only adds work.
 */
export function AnimatedCard({ children, index = 0, className }: Props) {
  const isTouch = useIsTouchDevice()

  const initialY = isTouch ? 12 : 24
  const duration = isTouch ? 0.35 : 0.7
  const margin = isTouch ? '-40px' : '-60px'
  const stagger = isTouch ? 0 : index * 0.1

  return (
    <motion.div
      initial={{ opacity: 0, y: initialY }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin }}
      transition={{ duration, delay: stagger, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  )
}
