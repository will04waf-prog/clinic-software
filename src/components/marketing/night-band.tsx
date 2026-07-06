'use client'

import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { PhoneCall } from 'lucide-react'

/**
 * NightBand — the "9:07 PM" cinematic photograph band.
 *
 * A full-bleed editorial photo of the demo clinic's reception at night —
 * front desk empty, phone still glowing mint — placed between the FAQ and
 * the founder note. It's the brand's core story told as a single image:
 * the front desk went home; the phone still answers.
 *
 * Motion budget (all decorative, all reduced-motion-safe):
 *  - Ken Burns: a 26s scale 1.0 → 1.07 alternate drift on the <img> itself
 *    (pure CSS, transform-only, inside prefers-reduced-motion: no-preference).
 *  - Scroll parallax: the overscanned wrapper translates ~8% slower than
 *    scroll via rAF. Gated on (hover: hover) and (pointer: fine) AND
 *    (prefers-reduced-motion: no-preference) — touch devices keep native
 *    compositor scroll, reduced-motion users get a still photograph.
 *    Lenis runs in native-scroll mode here, so plain window.scrollY is
 *    accurate every frame.
 *  - Film grain: an SVG-turbulence overlay jittering on steps(1), scoped to
 *    this section only (CSS in globals.css, same media gate).
 *
 * Hydration safety: server markup and first client paint are identical —
 * the copy renders with `opacity-0` until IntersectionObserver flips it to
 * the existing `.rise` entrance (same pattern as AnimatedSection), and the
 * parallax effect only ever mutates `style.transform` post-mount.
 *
 * Zero CLS: the section's height is fixed in CSS (70vh, min 500px) and the
 * lazy image is absolutely positioned inside it, so nothing reflows when
 * the JPEG arrives.
 */

/** How much slower than scroll the photograph travels. */
const PARALLAX_FACTOR = 0.08

export function NightBand() {
  const sectionRef = useRef<HTMLElement>(null)
  const parallaxRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

  // Reveal-on-scroll for the copy (IntersectionObserver → .rise), mirroring
  // AnimatedSection's approach so the whole page shares one entrance feel.
  useEffect(() => {
    const el = sectionRef.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisible(true)
          obs.disconnect()
        }
      },
      { rootMargin: '0px 0px -15% 0px' },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  // Scroll parallax — desktop fine-pointer, motion-tolerant users only.
  useEffect(() => {
    const section = sectionRef.current
    const layer = parallaxRef.current
    if (!section || !layer) return
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return

    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)')
    const motionOk = window.matchMedia('(prefers-reduced-motion: no-preference)')
    if (!finePointer.matches || !motionOk.matches) return

    let rafId = 0
    let ticking = false

    const update = () => {
      ticking = false
      const rect = section.getBoundingClientRect()
      const viewportH = window.innerHeight
      // Only pay for work while the band is actually on screen.
      if (rect.bottom < 0 || rect.top > viewportH) return
      // 0 when the section's center crosses the viewport's center; the
      // photo lags the scroll by PARALLAX_FACTOR of that distance.
      const delta = rect.top + rect.height / 2 - viewportH / 2
      layer.style.transform = `translate3d(0, ${(delta * PARALLAX_FACTOR).toFixed(2)}px, 0)`
    }

    const schedule = () => {
      if (!ticking) {
        ticking = true
        rafId = requestAnimationFrame(update)
      }
    }

    update()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule, { passive: true })
    return () => {
      cancelAnimationFrame(rafId)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      layer.style.transform = ''
    }
  }, [])

  // Copy enters via the site's shared .rise entrance once the section is on
  // screen; until then it holds at opacity-0 (server markup = first paint).
  const enter = visible ? 'rise' : 'opacity-0'

  return (
    <section
      ref={sectionRef}
      className="night-band relative w-full overflow-hidden"
      aria-label="After hours at the clinic — Layla is still answering"
    >
      {/* Photograph — overscanned wrapper takes the parallax translate,
          the <img> itself takes the Ken Burns scale. Separate elements so
          the two transforms never fight. */}
      <div ref={parallaxRef} className="night-band-parallax">
        <img
          src="/night-reception.jpg"
          alt="An upscale med-spa reception at night — cream armchairs and a forest accent wall lit by the windows, the front desk empty, a phone glowing mint on the counter"
          width={2560}
          height={1429}
          loading="lazy"
          decoding="async"
          className="night-band-img absolute inset-0 h-full w-full object-cover"
          // Native-4K Nano Banana Pro shot (no signage by construction).
          // Crop favors the mint-glowing phone on the right — the shot's
          // whole point.
          style={{ objectPosition: '74% 52%' }}
        />
      </div>

      {/* Forest scrim so the copy reads over the photo. */}
      <div className="night-band-scrim" aria-hidden="true" />

      {/* Film grain — this section only. */}
      <div className="night-band-grain" aria-hidden="true" />

      {/* Copy — bottom-left, entering via the shared .rise vocabulary. */}
      <div className="absolute inset-x-0 bottom-0 z-10 px-6 pb-16 sm:px-10 sm:pb-20 lg:px-16">
        <p
          style={{ '--stagger': 0 } as CSSProperties}
          className={`${enter} text-[11px] font-semibold uppercase tracking-[0.22em] text-[#02C39A] sm:text-xs`}
        >
          9:07 PM · Somewhere in the DMV
        </p>
        <h2
          style={
            {
              '--stagger': 1,
              fontFamily: 'var(--font-newsreader), Newsreader, Georgia, serif',
            } as CSSProperties
          }
          className={`${enter} mt-3 max-w-xl text-3xl font-medium leading-[1.15] tracking-tight text-[#F5EFE1] sm:text-4xl lg:text-5xl`}
        >
          The front desk went home. <em>She didn&apos;t.</em>
        </h2>
        <a
          href="tel:+13019622856"
          style={{ '--stagger': 2 } as CSSProperties}
          className={`${enter} group mt-4 inline-flex min-h-[44px] items-center gap-2.5 text-lg font-extrabold tracking-tight text-[#02C39A] transition-colors hover:text-[#5CEAB8] sm:text-xl`}
        >
          <PhoneCall className="h-4 w-4 shrink-0" aria-hidden="true" />
          (301) 962-2856
          <span className="sr-only">— call Layla, the AI receptionist, right now</span>
        </a>
      </div>

      {/* Forest wedge easing the cut into the founder section below. */}
      <div className="night-band-wedge" aria-hidden="true" />
    </section>
  )
}
