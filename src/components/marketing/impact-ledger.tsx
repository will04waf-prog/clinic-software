'use client'

/**
 * Impact Ledger — the value-pillars strip with an honest count-up.
 *
 * Visually identical at rest to the static 3-tile grid it replaces
 * ("16 voice tools" / "Day-before recall" / "One stack"), plus a
 * one-line "money walking out the door" ledger beneath it. When the
 * strip first scrolls into view:
 *
 *   - the "16" snaps to 0 and counts up to 16 (~1s, easeOutExpo, rAF)
 *   - the ledger line assembles left-to-right and its "$4,300/mo"
 *     counts up on the same clock
 *
 * SSR / no-JS / reduced-motion honesty: the server renders every FINAL
 * value and the first client paint matches it exactly — the zeros only
 * ever exist for the duration of the animation, triggered inside a
 * one-shot IntersectionObserver (same rootMargin as AnimatedSection).
 * prefers-reduced-motion skips the whole performance and leaves the
 * static final values in place.
 *
 * The math in the ledger is deliberately labeled as illustrative — the
 * footnote cites the source and concedes variance. Premium spa calm,
 * not crypto-dashboard hype.
 *
 * Drop-in: replaces the grid inside the value-pillars AnimatedSection.
 *   <ImpactLedger />
 */

import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'

/** Final values — the only numbers the server (and no-JS clients) ever see. */
const TOOL_COUNT = 16
const MONTHLY_LOSS = 4300

/** Count-up timing (ms). The dollar figure starts late so the ledger
 *  reads as a consequence of the strip, not a race with it. */
const TOOLS_DURATION = 1000
const DOLLARS_DELAY = 350
const DOLLARS_DURATION = 1050

/** Stagger between ledger segments as they assemble (ms). */
const SEGMENT_STAGGER = 140

const easeOutExpo = (x: number): number => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x))

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)

const formatDollars = (v: number): string => `$${v.toLocaleString('en-US')}`

/**
 * 'rest'  — SSR + first paint + reduced-motion: final values, no styles.
 * 'reset' — one committed frame of zeros / hidden segments.
 * 'play'  — transitions + rAF count-up toward the finals.
 */
type Stage = 'rest' | 'reset' | 'play'

const PILLARS: { stat: string; label: string }[] = [
  {
    stat: '16 voice tools', // rendered specially — the 16 counts up
    label: 'Layla can book, reschedule, transfer, take messages, and more on every call',
  },
  {
    stat: 'Day-before recall',
    label: 'Outbound AI reminder calls 4–72 hours ahead — patients confirm or move by voice',
  },
  {
    stat: 'One stack',
    label: 'Voice, two-way SMS, public booking, and CRM on a single phone number',
  },
]

export function ImpactLedger() {
  const ref = useRef<HTMLDivElement>(null)
  const [stage, setStage] = useState<Stage>('rest')
  const [tools, setTools] = useState(TOOL_COUNT)
  const [dollars, setDollars] = useState(MONTHLY_LOSS)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    // Reduced motion or no IO support: stay at rest — finals are already
    // on screen, nothing to do.
    if (
      typeof IntersectionObserver === 'undefined' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return
    }

    let rafId = 0

    const run = () => {
      // Frame 1: commit the zeros so the browser paints the "before"
      // state; frame 2: flip to 'play' so the CSS transitions fire and
      // the rAF clock starts.
      setStage('reset')
      setTools(0)
      setDollars(0)
      rafId = requestAnimationFrame(() => {
        rafId = requestAnimationFrame(() => {
          setStage('play')
          const start = performance.now()
          const tick = (now: number) => {
            const t = now - start
            const pTools = easeOutExpo(clamp01(t / TOOLS_DURATION))
            const pDollars = easeOutExpo(clamp01((t - DOLLARS_DELAY) / DOLLARS_DURATION))
            setTools(Math.round(pTools * TOOL_COUNT))
            setDollars(Math.round(pDollars * MONTHLY_LOSS))
            if (t < DOLLARS_DELAY + DOLLARS_DURATION) {
              rafId = requestAnimationFrame(tick)
            } else {
              // Land exactly on the finals — no rounding drift.
              setTools(TOOL_COUNT)
              setDollars(MONTHLY_LOSS)
            }
          }
          rafId = requestAnimationFrame(tick)
        })
      })
    }

    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          obs.disconnect()
          run()
        }
      },
      { rootMargin: '0px 0px -15% 0px' },
    )
    obs.observe(el)
    return () => {
      obs.disconnect()
      cancelAnimationFrame(rafId)
    }
  }, [])

  /** Assembly styles for the ledger segments (index = stagger slot).
   *  At rest there are NO inline styles, so SSR markup is untouched. */
  const segment = (i: number): CSSProperties | undefined => {
    if (stage === 'rest') return undefined
    if (stage === 'reset') return { opacity: 0, transform: 'translateY(6px)' }
    return {
      opacity: 1,
      transform: 'translateY(0)',
      transition: [
        `opacity 500ms ease ${i * SEGMENT_STAGGER}ms`,
        `transform 500ms cubic-bezier(0.16, 1, 0.3, 1) ${i * SEGMENT_STAGGER}ms`,
      ].join(', '),
    }
  }

  return (
    <div ref={ref}>
      {/* Exact recreation of the resting value-pillars grid */}
      <div className="grid gap-px overflow-hidden rounded-2xl border border-gray-200 bg-gray-200 shadow-sm sm:grid-cols-3">
        {PILLARS.map(({ stat, label }, i) => (
          <div key={stat} className="bg-[#F5EFE1] px-6 py-6 text-center">
            <div className="text-xl font-extrabold tracking-tight text-[#14241d]">
              {i === 0 ? (
                <>
                  {/* Animated digits are decorative churn — screen readers
                      get the stable final value from the sr-only twin. */}
                  <span aria-hidden="true" className="tabular-nums">
                    {tools}
                  </span>
                  <span className="sr-only">{TOOL_COUNT}</span> voice tools
                </>
              ) : (
                stat
              )}
            </div>
            <p className="mt-1 text-sm text-gray-500 leading-relaxed">{label}</p>
          </div>
        ))}
      </div>

      {/* The honest ledger — assembles on the same intersect */}
      <div className="mx-auto mt-4 max-w-5xl text-center">
        <p className="flex flex-wrap items-baseline justify-center gap-x-1.5 gap-y-0.5 leading-snug">
          <span
            style={segment(0)}
            className="inline-block text-xs font-medium text-[#B5710F] sm:text-sm"
          >
            25% of calls missed × ~20 calls/day × $250 consult ≈
          </span>
          <span
            style={segment(1)}
            className="inline-block text-lg font-extrabold tracking-tight text-[#B5710F] sm:text-xl"
          >
            <span aria-hidden="true" className="tabular-nums">
              {formatDollars(dollars)}
            </span>
            <span className="sr-only">{formatDollars(MONTHLY_LOSS)}</span>
            /mo
          </span>
          <span
            style={segment(2)}
            className="inline-block text-xs font-medium text-[#B5710F] sm:text-sm"
          >
            walking out the door.
          </span>
        </p>
        <p style={segment(3)} className="mx-auto mt-1.5 max-w-xl text-[11px] leading-relaxed text-gray-400">
          Illustrative math — miss rate is the conservative end of Invoca&apos;s 2021 healthcare
          benchmark; your numbers will vary.
        </p>
      </div>
    </div>
  )
}
