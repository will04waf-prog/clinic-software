'use client'

/**
 * StickyCallPill — the demo number that never dies.
 *
 * The hero's demo-line card is the strongest proof on the page, but it
 * scrolls away. This keeps (301) 962-2856 one tap away for the rest of
 * the visit: a compact floating pill tucked under the sticky header on
 * desktop, a slim thumb-reach bottom bar on mobile.
 *
 * Visibility is derived, never toggled ad-hoc, from ONE persistent
 * IntersectionObserver watching two anchors the page provides:
 *   #demo-line  — the hero tel: card. The pill appears only once the
 *                 visitor has scrolled PAST it (not intersecting AND
 *                 boundingClientRect.top < 0), so it never doubles the
 *                 hero while the real card is on screen — and never
 *                 fires when the card is still BELOW the fold.
 *   #final-cta  — the dark closing section. The pill bows out while it
 *                 is in view; it must not compete with the page's own
 *                 closing ask.
 * A dismiss X silences it for the session (sessionStorage).
 *
 * SSR-safe: renders null until after hydration (everything here is
 * position: fixed, so there is no CLS), and all Framer springs sit
 * inside <MotionConfig reducedMotion="user">.
 *
 * Also renders the .scroll-progress-hairline div — a 2px teal→mint
 * reading line across the very top of the viewport, filled by a pure
 * CSS scroll-driven animation (animation-timeline: scroll(root), see
 * globals.css). Zero JS per frame; silently absent in browsers without
 * scroll-timeline support and under reduced motion.
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import { PhoneCall, X } from 'lucide-react'

const HERO_CARD_ID = 'demo-line'
const FINAL_CTA_ID = 'final-cta'
const DISMISS_KEY = 'tarhunna-call-pill-dismissed'
const TEL_HREF = 'tel:+13019622856'
const NUMBER = '(301) 962-2856'
const CALL_LABEL = `Call the live demo line, ${NUMBER} — Layla answers`

/** Desktop = a real cursor AND a viewport wide enough for a corner pill.
 *  hover/pointer (not width alone) decides, so a touch laptop in a wide
 *  window still gets the thumb-friendly bottom bar. */
const DESKTOP_QUERY = '(hover: hover) and (pointer: fine) and (min-width: 640px)'

const SPRING = { type: 'spring', stiffness: 420, damping: 32 } as const

/* useSyncExternalStore plumbing (module scope so identities are stable).
   The store-that-never-changes yields a lint-clean "mounted" flag: React
   uses the server snapshot (false) during hydration, then re-reads the
   client snapshot (true) immediately after — no setState-in-effect. */
const emptySubscribe = () => () => {}
const snapshotTrue = () => true
const snapshotFalse = () => false

function subscribeToDesktopQuery(onChange: () => void) {
  const mq = window.matchMedia(DESKTOP_QUERY)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}
const readDesktopQuery = () => window.matchMedia(DESKTOP_QUERY).matches

/** Compact pill under the sticky header (header is z-50; we sit at z-40). */
function DesktopPill({ onDismiss }: { onDismiss: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={SPRING}
      className="fixed right-4 top-[70px] z-40"
    >
      <div className="flex items-center gap-1 rounded-full border border-brand-500/40 bg-[#FAF6EC]/95 pl-4 pr-1 shadow-lg shadow-[#14241D]/10 backdrop-blur-sm">
        <a
          href={TEL_HREF}
          aria-label={CALL_LABEL}
          className="group flex items-center gap-2.5 rounded-full py-1.5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#028090]"
        >
          <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden="true">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-500/60 [animation-duration:2.2s] motion-reduce:animate-none" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-brand-500" />
          </span>
          <span className="flex flex-col text-left leading-tight">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#028090]">
              Layla is live
            </span>
            <span className="text-sm font-extrabold tracking-tight text-gray-900 transition-colors group-hover:text-[#026B78]">
              {NUMBER}
            </span>
          </span>
        </a>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss the demo-line reminder"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-[#14241D]/5 hover:text-gray-700 focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-[#028090]"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </motion.div>
  )
}

/** Slim full-width bottom bar in the thumb zone; safe-area aware. */
function MobileBar({ onDismiss }: { onDismiss: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 16 }}
      transition={SPRING}
      className="fixed inset-x-3 z-40"
      style={{ bottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
    >
      <div className="flex h-12 items-center overflow-hidden rounded-full bg-[#14241D] text-[#F5EFE1] shadow-lg shadow-[#14241D]/30">
        <a
          href={TEL_HREF}
          aria-label={CALL_LABEL}
          className="flex h-full min-w-0 flex-1 items-center justify-center gap-2 pl-4 focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-[#02C39A]"
        >
          <PhoneCall className="h-4 w-4 shrink-0 text-brand-500" aria-hidden="true" />
          <span className="truncate text-sm font-semibold tracking-tight">
            {NUMBER} <span className="font-normal text-[#F5EFE1]/70">— Layla answers</span>
          </span>
        </a>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss the demo-line bar"
          className="flex h-12 w-12 shrink-0 items-center justify-center text-[#F5EFE1]/70 transition-colors hover:text-[#F5EFE1] focus-visible:outline-2 focus-visible:outline-offset-[-6px] focus-visible:outline-[#02C39A]"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </motion.div>
  )
}

export function StickyCallPill() {
  // false on the server and during the hydration render, true right after.
  // Everything below is position: fixed, so appearing a frame later costs
  // no layout shift — and server markup === first client render (null).
  const mounted = useSyncExternalStore(emptySubscribe, snapshotTrue, snapshotFalse)
  // Desktop vs mobile presentation, kept live across resizes / input changes.
  const isDesktop = useSyncExternalStore(subscribeToDesktopQuery, readDesktopQuery, snapshotFalse)

  // Lazy initializer, guarded for SSR. Hydration-safe because `mounted`
  // keeps the first client render null regardless of what storage says —
  // and it avoids a post-mount flash of a pill the visitor already dismissed.
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined') return false
    try {
      return sessionStorage.getItem(DISMISS_KEY) === '1'
    } catch {
      // Storage unavailable (private mode / blocked) — treat as not dismissed.
      return false
    }
  })
  const [heroPassed, setHeroPassed] = useState(false)
  const [finalCtaInView, setFinalCtaInView] = useState(false)

  // One observer, two anchors, for the whole page lifetime.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const heroCard = document.getElementById(HERO_CARD_ID)
    const finalCta = document.getElementById(FINAL_CTA_ID)
    // No hero anchor → never show. Fails safe if the ids aren't wired up.
    if (!heroCard) return
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === heroCard) {
          // "Past" = gone off the TOP. A hero card still below the fold
          // (deep-link mid-page, then scroll up) must not trigger.
          setHeroPassed(!entry.isIntersecting && entry.boundingClientRect.top < 0)
        } else if (entry.target === finalCta) {
          setFinalCtaInView(entry.isIntersecting)
        }
      }
    })
    observer.observe(heroCard)
    if (finalCta) observer.observe(finalCta)
    return () => observer.disconnect()
  }, [])

  const dismiss = useCallback(() => {
    setDismissed(true)
    try {
      sessionStorage.setItem(DISMISS_KEY, '1')
    } catch {
      // Best effort — worst case the pill returns on the next page load.
    }
  }, [])

  if (!mounted) return null

  const visible = !dismissed && heroPassed && !finalCtaInView

  return (
    <MotionConfig reducedMotion="user">
      {/* Pure-CSS scroll progress; styled + gated in globals.css. */}
      <div className="scroll-progress-hairline" aria-hidden="true" />
      <AnimatePresence>
        {visible &&
          (isDesktop ? (
            <DesktopPill key="pill-desktop" onDismiss={dismiss} />
          ) : (
            <MobileBar key="pill-mobile" onDismiss={dismiss} />
          ))}
      </AnimatePresence>
    </MotionConfig>
  )
}
