'use client'

import { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'

/**
 * BilingualRoll — a rolling pill highlight over stacked EN/ES lines
 * (Spline "Real-time" gallery tile, adapted to the bilingual pitch).
 *
 * Each line is the same receptionist verb in English then Spanish; a
 * pill outline rolls down the stack one line at a time, so the card
 * *shows* Layla switching languages instead of describing it. The
 * morph is a framer-motion shared-layout transition (already a
 * dependency), so there's no per-frame measurement code.
 *
 * Battery + a11y: the cycle only runs while the stack is on screen
 * (IntersectionObserver), and under prefers-reduced-motion the pill
 * sits statically on the first Spanish line.
 */

const LINES = [
  { text: 'She answers.', lang: 'EN' },
  { text: 'Ella contesta.', lang: 'ES' },
  { text: 'She books.', lang: 'EN' },
  { text: 'Ella agenda.', lang: 'ES' },
  { text: 'She confirms.', lang: 'EN' },
  { text: 'Ella confirma.', lang: 'ES' },
] as const

const STEP_MS = 1400

export function BilingualRoll({ layoutId = 'bilingual-roll-pill' }: { layoutId?: string }) {
  const reduced = useReducedMotion()
  const ref = useRef<HTMLDivElement>(null)
  const [inView, setInView] = useState(false)
  const [pageVisible, setPageVisible] = useState(true)
  // Under reduced motion, park the pill on the first Spanish line so
  // the bilingual point still lands without any movement.
  const [active, setActive] = useState(reduced ? 1 : 0)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { threshold: 0.35 },
    )
    io.observe(el)
    const onVisibility = () => setPageVisible(document.visibilityState === 'visible')
    onVisibility()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      io.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  useEffect(() => {
    if (reduced) {
      setActive(1)
      return
    }
    if (!inView || !pageVisible) return
    const id = setInterval(() => setActive((a) => (a + 1) % LINES.length), STEP_MS)
    return () => clearInterval(id)
  }, [inView, pageVisible, reduced])

  return (
    <div
      ref={ref}
      className="mt-5 rounded-xl border border-gray-200/70 bg-white/50 py-4"
      aria-label="Layla answers in English and Spanish"
    >
      <div className="flex flex-col items-center gap-0.5">
        {LINES.map((line, i) => {
          const isActive = i === active
          return (
            <div key={line.text} className="relative w-fit px-4 py-1">
              {isActive && (
                <motion.span
                  layoutId={layoutId}
                  transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 34 }}
                  className="absolute inset-0 rounded-full border border-[#02C39A]/60 bg-white shadow-sm"
                  aria-hidden="true"
                />
              )}
              <span
                className={`relative z-10 flex items-baseline gap-2 text-base font-semibold transition-colors duration-300 sm:text-lg ${
                  isActive ? 'text-[#14241d]' : 'text-gray-400/80'
                }`}
              >
                {line.text}
                <span
                  className={`text-[9px] font-bold uppercase tracking-widest transition-colors duration-300 ${
                    isActive ? 'text-[#028090]' : 'text-gray-300'
                  }`}
                >
                  {line.lang}
                </span>
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
