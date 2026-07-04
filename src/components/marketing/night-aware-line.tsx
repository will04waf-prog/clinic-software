'use client'

import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'

/**
 * NightAwareLine — the hero demo-card eyebrow that knows what time it is.
 *
 * The strongest proof on the page is that Layla answers when a human front
 * desk can't. So after mount this line re-targets to the VISITOR'S local
 * clock: during business hours it stays matter-of-fact, in the evening and
 * overnight it points out — warmly, factually — that the desk is closed and
 * Layla still picks up.
 *
 * Hydration-safe by construction: server markup and the first client paint
 * both render the neutral "Live demo — Layla will answer"; the time-aware
 * copy only swaps in from a useEffect. Swaps crossfade over ~200ms with
 * zero layout shift — the container has a fixed one-line height and
 * contributes zero intrinsic width (width:0 / minWidth:100%), so a longer
 * line can never widen the w-fit demo card; overflow ellipsizes instead.
 * A 60s interval keeps the displayed minute honest while the user lingers.
 * prefers-reduced-motion: the crossfade classes (see globals.css) only
 * animate under (prefers-reduced-motion: no-preference); otherwise the
 * copy swaps instantly.
 */

const STATIC_LINE = 'Live demo — Layla will answer'

/** How long the exiting layer stays mounted — fade duration plus margin. */
const EXIT_LAYER_MS = 240

/** 12-hour clock parts with a correctly computed meridiem (23:07 → 11:07 PM). */
function twelveHourClock(date: Date): { h: number; mm: string; meridiem: 'AM' | 'PM' } {
  const h24 = date.getHours()
  return {
    h: h24 % 12 === 0 ? 12 : h24 % 12,
    mm: String(date.getMinutes()).padStart(2, '0'),
    meridiem: h24 < 12 ? 'AM' : 'PM',
  }
}

/** Picks the eyebrow copy for the visitor's local time. */
function lineForTime(date: Date): string {
  const hour = date.getHours()
  if (hour >= 8 && hour < 18) return 'Live demo — Layla is answering right now'
  if (hour >= 5 && hour < 8) return "Before hours — she's already answering"
  const { h, mm, meridiem } = twelveHourClock(date)
  if (hour >= 18 && hour < 23) {
    return `It's ${h}:${mm} PM — your front desk is closed. Layla isn't.`
  }
  // 23:00–04:59 — 23h correctly reads 11:{mm} PM, 00–04h read {h}:{mm} AM.
  return `${h}:${mm} ${meridiem} and she still picks up. Try her.`
}

// Fixed one-line box: height is pinned so copy swaps never move the phone
// number below; width:0 keeps this line out of the card's intrinsic (w-fit)
// width so the card is sized purely by its other lines, and minWidth:100%
// then claims that settled width back.
const containerStyle: CSSProperties = {
  position: 'relative',
  display: 'block',
  height: '1.5em',
  lineHeight: 1.5,
  width: 0,
  minWidth: '100%',
}

// Each copy layer fills the container and ellipsizes rather than wrapping,
// so an over-long evening line truncates instead of shifting layout.
const layerStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

type Display = {
  text: string
  /** The line fading out under the incoming one; null once the fade ends. */
  prevText: string | null
  /** Bumped per swap — keys the entering layer so its fade restarts. */
  gen: number
}

type Props = {
  /** Eyebrow classes from the demo card (sizing, tracking, color). */
  className?: string
}

export function NightAwareLine({ className }: Props) {
  const [display, setDisplay] = useState<Display>({
    text: STATIC_LINE,
    prevText: null,
    gen: 0,
  })

  // Swap to local-clock copy after mount, then keep the minute fresh.
  useEffect(() => {
    const update = () => {
      const next = lineForTime(new Date())
      setDisplay((d) =>
        d.text === next ? d : { text: next, prevText: d.text, gen: d.gen + 1 },
      )
    }
    update()
    const intervalId = window.setInterval(update, 60_000)
    return () => window.clearInterval(intervalId)
  }, [])

  // Unmount the exiting layer once its fade has finished.
  useEffect(() => {
    if (display.prevText === null) return
    const timeoutId = window.setTimeout(() => {
      setDisplay((d) => (d.gen === display.gen ? { ...d, prevText: null } : d))
    }, EXIT_LAYER_MS)
    return () => window.clearTimeout(timeoutId)
  }, [display.gen, display.prevText])

  return (
    <span className={className} style={containerStyle}>
      {display.prevText !== null && (
        <span aria-hidden="true" className="night-line-exit" style={layerStyle}>
          {display.prevText}
        </span>
      )}
      <span
        key={display.gen}
        className={display.gen > 0 ? 'night-line-enter' : undefined}
        style={layerStyle}
      >
        {display.text}
      </span>
    </span>
  )
}
