'use client'

/**
 * DemoCallPill — parameterized sibling of StickyCallPill for the
 * vertical landing pages (/es, /trades), which feature the trades
 * demo line rather than the med-spa one.
 *
 * Same visibility contract as StickyCallPill (see that file for the
 * full rationale): ONE IntersectionObserver watching two anchors the
 * page provides —
 *   #demo-line — the hero tel: card; the pill appears only once the
 *                visitor has scrolled PAST it (top < 0).
 *   #final-cta — the dark closing section; the pill bows out there.
 * A dismiss X silences it for the session. SSR-safe (renders null
 * until after hydration; everything is position: fixed, zero CLS).
 * All springs sit inside <MotionConfig reducedMotion="user">.
 *
 * Every string is a prop so the Spanish page ships native copy and
 * the trades page ships its own number — no hardcoded med-spa line.
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import { PhoneCall, X } from 'lucide-react'

const HERO_CARD_ID = 'demo-line'
const FINAL_CTA_ID = 'final-cta'

const DESKTOP_QUERY = '(hover: hover) and (pointer: fine) and (min-width: 640px)'
const SPRING = { type: 'spring', stiffness: 420, damping: 32 } as const

const emptySubscribe = () => () => {}
const snapshotTrue = () => true
const snapshotFalse = () => false

function subscribeToDesktopQuery(onChange: () => void) {
  const mq = window.matchMedia(DESKTOP_QUERY)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}
const readDesktopQuery = () => window.matchMedia(DESKTOP_QUERY).matches

export type DemoCallPillProps = {
  /** tel: href, e.g. "tel:+18555894238" */
  telHref: string
  /** Display number, e.g. "(855) 589-4238" */
  number: string
  /** Tiny uppercase eyebrow on the desktop pill, e.g. "Layla is live". */
  eyebrow: string
  /** Suffix after the number on the mobile bar, e.g. "— Layla answers". */
  mobileNote: string
  /** aria-label for the call link. */
  callLabel: string
  /** aria-label for the dismiss button. */
  dismissLabel: string
  /** sessionStorage key so each page can remember its own dismissal. */
  storageKey?: string
}

function DesktopPill({
  telHref, number, eyebrow, callLabel, dismissLabel, onDismiss,
}: DemoCallPillProps & { onDismiss: () => void }) {
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
          href={telHref}
          aria-label={callLabel}
          className="group flex items-center gap-2.5 rounded-full py-1.5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#028090]"
        >
          <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden="true">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-500/60 [animation-duration:2.2s] motion-reduce:animate-none" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-brand-500" />
          </span>
          <span className="flex flex-col text-left leading-tight">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#028090]">
              {eyebrow}
            </span>
            <span className="text-sm font-extrabold tracking-tight text-gray-900 transition-colors group-hover:text-[#026B78]">
              {number}
            </span>
          </span>
        </a>
        <button
          type="button"
          onClick={onDismiss}
          aria-label={dismissLabel}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-[#14241D]/5 hover:text-gray-700 focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-[#028090]"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </motion.div>
  )
}

function MobileBar({
  telHref, number, mobileNote, callLabel, dismissLabel, onDismiss,
}: DemoCallPillProps & { onDismiss: () => void }) {
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
          href={telHref}
          aria-label={callLabel}
          className="flex h-full min-w-0 flex-1 items-center justify-center gap-2 pl-4 focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-[#02C39A]"
        >
          <PhoneCall className="h-4 w-4 shrink-0 text-brand-500" aria-hidden="true" />
          <span className="truncate text-sm font-semibold tracking-tight">
            {number} <span className="font-normal text-[#F5EFE1]/70">{mobileNote}</span>
          </span>
        </a>
        <button
          type="button"
          onClick={onDismiss}
          aria-label={dismissLabel}
          className="flex h-12 w-12 shrink-0 items-center justify-center text-[#F5EFE1]/70 transition-colors hover:text-[#F5EFE1] focus-visible:outline-2 focus-visible:outline-offset-[-6px] focus-visible:outline-[#02C39A]"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </motion.div>
  )
}

export function DemoCallPill(props: DemoCallPillProps) {
  const { storageKey = 'tarhunna-demo-call-pill-dismissed' } = props
  const mounted = useSyncExternalStore(emptySubscribe, snapshotTrue, snapshotFalse)
  const isDesktop = useSyncExternalStore(subscribeToDesktopQuery, readDesktopQuery, snapshotFalse)

  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined') return false
    try {
      return sessionStorage.getItem(storageKey) === '1'
    } catch {
      return false
    }
  })
  const [heroPassed, setHeroPassed] = useState(false)
  const [finalCtaInView, setFinalCtaInView] = useState(false)

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const heroCard = document.getElementById(HERO_CARD_ID)
    const finalCta = document.getElementById(FINAL_CTA_ID)
    if (!heroCard) return
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === heroCard) {
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
      sessionStorage.setItem(storageKey, '1')
    } catch {
      // Best effort — worst case the pill returns on the next page load.
    }
  }, [storageKey])

  if (!mounted) return null

  const visible = !dismissed && heroPassed && !finalCtaInView

  return (
    <MotionConfig reducedMotion="user">
      {/* Pure-CSS scroll progress; styled + gated in globals.css. */}
      <div className="scroll-progress-hairline" aria-hidden="true" />
      <AnimatePresence>
        {visible &&
          (isDesktop ? (
            <DesktopPill key="pill-desktop" {...props} onDismiss={dismiss} />
          ) : (
            <MobileBar key="pill-mobile" {...props} onDismiss={dismiss} />
          ))}
      </AnimatePresence>
    </MotionConfig>
  )
}
