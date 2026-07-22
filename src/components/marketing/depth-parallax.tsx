'use client'

import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

/**
 * Depth parallax — the wrapped block drifts a few percent slower than
 * scroll, so the showcase gains z-depth. Ported from the division
 * sites' stage parallax (tarhunna-technologies/divisions/web).
 *
 * Discipline (same as the divisions + night-band):
 * - ONE module-level rAF shared by every instance on the page; the
 *   passive scroll listener only queues a frame.
 * - Transform-only writes on an inner layer, so the effect never
 *   fights entrance transitions on ancestors and never causes layout.
 * - No layout reads in the loop: each layer's document-space rect is
 *   cached on mount and refreshed on resize; the loop only reads
 *   window.scrollY / innerHeight.
 * - Off-screen layers are skipped entirely.
 * - Gated: fine pointer + motion allowed. Touch and reduced-motion
 *   visitors get static markup — the effect never arms, so server
 *   HTML always equals first client paint.
 */

type Layer = {
  outer: HTMLElement
  inner: HTMLElement
  factor: number
  top: number
  height: number
}

const layers = new Set<Layer>()
let ticking = false
let listening = false

function measure(layer: Layer) {
  const rect = layer.outer.getBoundingClientRect()
  layer.top = rect.top + window.scrollY
  layer.height = rect.height
}

function paint() {
  ticking = false
  const vh = window.innerHeight || 1
  const y = window.scrollY
  layers.forEach((layer) => {
    // Off-stage (±120px margin): no writes.
    if (layer.top + layer.height < y - 120 || layer.top > y + vh + 120) return
    const mid = layer.top - y + layer.height / 2 - vh / 2
    layer.inner.style.transform = `translate3d(0, ${(-mid * layer.factor).toFixed(2)}px, 0)`
  })
}

function queueFrame() {
  if (!ticking) {
    ticking = true
    window.requestAnimationFrame(paint)
  }
}

function onResize() {
  layers.forEach(measure)
  queueFrame()
}

function attach() {
  if (listening) return
  listening = true
  window.addEventListener('scroll', queueFrame, { passive: true })
  window.addEventListener('resize', onResize, { passive: true })
}

function detach() {
  if (!listening) return
  listening = false
  window.removeEventListener('scroll', queueFrame)
  window.removeEventListener('resize', onResize)
}

type Props = {
  children: ReactNode
  /** Fraction of scroll the block lags by (0.04–0.06 reads right). */
  factor?: number
  className?: string
}

export function DepthParallax({ children, factor = 0.05, className }: Props) {
  const outerRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const outer = outerRef.current
    const inner = innerRef.current
    if (!outer || !inner) return
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches
    const wantsMotion = window.matchMedia('(prefers-reduced-motion: no-preference)').matches
    if (!finePointer || !wantsMotion) return

    const layer: Layer = { outer, inner, factor, top: 0, height: 0 }
    measure(layer)
    layers.add(layer)
    attach()
    queueFrame()

    return () => {
      layers.delete(layer)
      inner.style.transform = ''
      if (layers.size === 0) detach()
    }
  }, [factor])

  return (
    <div ref={outerRef} className={className}>
      <div ref={innerRef}>{children}</div>
    </div>
  )
}
