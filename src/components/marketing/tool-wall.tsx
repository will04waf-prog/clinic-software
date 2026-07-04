'use client'

/**
 * Tool Wall — the transcript-lit scrollytelling centerpiece for the
 * "What Layla does on every call" section.
 *
 * Replaces the flat 16-card grid with a split layout: a fictional (but
 * demo-line-accurate) call transcript on the left, and the 16-tool wall
 * pinned on the right. As the reader scrolls the conversation, each
 * line "fires" its voice tools and the matching cells light up — by the
 * closing line the whole wall is lit and the counter reads 16 of 16.
 *
 * Mechanics:
 *   - One PERSISTENT IntersectionObserver (rootMargin -45%/-45% = a
 *     thin band at the viewport's vertical center) watches every
 *     transcript line. Unlike AnimatedSection's one-shot observer, it
 *     stays connected so the wall dims again when you scroll back up.
 *   - Lit set = cumulative union of tools[] for lines 0..active
 *     (precomputed in CUMULATIVE — no per-scroll set math).
 *   - A cell transitioning unlit→lit remounts its icon (key swap) with
 *     the existing .pop-in utility for a tiny "tool call" blip.
 *   - Mobile (< lg): no sticky pane — each line reveals its tool chips
 *     inline, one-shot, in reading order.
 *
 * Reduced motion: everything renders lit and full-opacity, observers
 * never attach (.pop-in is already no-op'd in globals.css).
 * SSR: activeIdx = -1 → full layout, all cells unlit, zero CLS.
 */

import { useEffect, useRef, useState } from 'react'
import {
  CalendarSearch, Clock, CalendarCheck, BellRing, Search, RefreshCw, CalendarX,
  Sparkles, HelpCircle, MapPin, ClipboardList, BookOpen, MessageSquare, Voicemail,
  PhoneForwarded, Mail, type LucideIcon,
} from 'lucide-react'

// The 16 voice tools — same inventory (fn / label / icon) as the
// LaylaShowcase finale grid, so the two sections tell one story.
const TOOLS: { fn: string; label: string; Icon: LucideIcon }[] = [
  { fn: 'find_service',            label: 'Find a service',     Icon: Sparkles },
  { fn: 'lookup_faq',             label: 'Answer FAQs',        Icon: HelpCircle },
  { fn: 'give_directions',        label: 'Give directions',    Icon: MapPin },
  { fn: 'get_context',            label: 'Know your clinic',   Icon: BookOpen },
  { fn: 'lookup_availability',    label: 'Check availability', Icon: CalendarSearch },
  { fn: 'create_hold',            label: 'Hold a slot',        Icon: Clock },
  { fn: 'confirm_booking',        label: 'Book it',            Icon: CalendarCheck },
  { fn: 'send_link_sms',          label: 'Text a link',        Icon: MessageSquare },
  { fn: 'lookup_my_appointments', label: 'Find your visit',    Icon: Search },
  { fn: 'reschedule_appointment', label: 'Reschedule',         Icon: RefreshCw },
  { fn: 'cancel_appointment',     label: 'Cancel',             Icon: CalendarX },
  { fn: 'pre_visit_instructions', label: 'Prep instructions',  Icon: ClipboardList },
  { fn: 'confirm_appointment',    label: 'Confirm reminders',  Icon: BellRing },
  { fn: 'take_message',           label: 'Take a message',     Icon: Voicemail },
  { fn: 'transfer_to_human',      label: 'Transfer to staff',  Icon: PhoneForwarded },
  { fn: 'post_call_summary_email',label: 'Email a recap',      Icon: Mail },
]

const FN_LABEL: Record<string, string> = Object.fromEntries(
  TOOLS.map(({ fn, label }) => [fn, label]),
)

type TranscriptLine = { who: 'caller' | 'layla'; text: string; tools: string[] }

// Fictional call, flavor-matched to the live demo line (301) 962-2856.
// INVARIANT: every one of the 16 tool fns above appears in exactly one
// line's tools[] — the wall must finish at 16 of 16.
const TRANSCRIPT: TranscriptLine[] = [
  { who: 'layla',  text: 'Thank you for calling Tarhunna Aesthetics — this call may be recorded — I’m Layla, how can I help?', tools: ['get_context'] },
  { who: 'caller', text: 'Hi — do you have anything for Botox this Thursday?', tools: ['find_service'] },
  { who: 'layla',  text: 'We do — I’ve got 2:30 or 4:15 with Dr. Rivera on Thursday; which works better?', tools: ['lookup_availability'] },
  { who: 'caller', text: 'Let’s do 2:30, please.', tools: ['create_hold'] },
  { who: 'layla',  text: 'You’re booked — Botox, Thursday 2:30 with Dr. Rivera — and I’m texting you the booking link now.', tools: ['confirm_booking', 'send_link_sms'] },
  { who: 'caller', text: 'Great — and where exactly are you located, is there parking?', tools: [] },
  { who: 'layla',  text: 'We’re on Wisconsin Avenue in Bethesda, and yes — free garage parking right behind the building.', tools: ['give_directions', 'lookup_faq'] },
  { who: 'caller', text: 'One more thing — I need to move my facial this Friday and cancel the brow wax.', tools: ['lookup_my_appointments'] },
  { who: 'layla',  text: 'Done — your facial is moved to Monday at 11:00, the brow wax is cancelled, and I’ve re-sent your prep instructions.', tools: ['reschedule_appointment', 'cancel_appointment', 'pre_visit_instructions'] },
  { who: 'caller', text: 'Could I also leave a note for the office manager about my invoice?', tools: [] },
  { who: 'layla',  text: 'Of course — I’ve taken your message, and if it’s urgent I can transfer you to the front desk right now.', tools: ['take_message', 'transfer_to_human'] },
  { who: 'caller', text: 'No need — that’s everything, thank you!', tools: [] },
  { who: 'layla',  text: 'My pleasure — the owner gets a recap email of this call, and I’ll ring you tomorrow to confirm Thursday’s visit.', tools: ['post_call_summary_email', 'confirm_appointment'] },
]

// CUMULATIVE[i] = union of tools[] for lines 0..i, so the lit set for
// any active line is a single array lookup during scroll.
const CUMULATIVE: ReadonlySet<string>[] = TRANSCRIPT.reduce<Set<string>[]>((acc, line, i) => {
  const prev = i > 0 ? acc[i - 1] : new Set<string>()
  acc.push(new Set([...prev, ...line.tools]))
  return acc
}, [])

const EMPTY: ReadonlySet<string> = new Set()

// Bubble visual language mirrors LaylaShowcase: Layla = white bubble
// with a mint hairline and a squared bottom-left corner; caller =
// forest gradient with a squared bottom-right corner.
const BUBBLE_BASE =
  'max-w-[400px] rounded-2xl px-3.5 py-2.5 text-left text-[14.5px] leading-normal'
const LAYLA_BUBBLE = `${BUBBLE_BASE} rounded-bl-[4px] border border-[rgba(2,195,154,0.22)] bg-white text-[#0B2027]`
const CALLER_BUBBLE = `${BUBBLE_BASE} rounded-br-[4px] bg-gradient-to-br from-[#0B2027] to-[#16323b] text-white`

/** SSR-safe reduced-motion flag: false on the server and the first
 *  client render, resolved in an effect (no hydration mismatch). */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const apply = () => setReduced(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])
  return reduced
}

function Bubble({ line }: { line: TranscriptLine }) {
  const isLayla = line.who === 'layla'
  return (
    <>
      {isLayla && (
        <span
          aria-hidden
          className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#02C39A] to-[#028090] text-[13px] font-bold text-white"
          style={{ fontFamily: 'var(--font-newsreader, Georgia, serif)' }}
        >
          L
        </span>
      )}
      <p className={isLayla ? LAYLA_BUBBLE : CALLER_BUBBLE}>
        <span
          className={`mb-0.5 block text-[11px] font-bold uppercase tracking-[0.08em] ${
            isLayla ? 'text-[#028090]' : 'text-white/85'
          }`}
        >
          {isLayla ? 'Layla' : 'Caller'}
        </span>
        {line.text}
      </p>
    </>
  )
}

/** Mobile line: bubble + inline tool chips that fade-slide in the
 *  first time the line enters the viewport (one-shot, like
 *  AnimatedSection — no reversal needed in a linear reading flow). */
function MobileLine({ line, forceVisible }: { line: TranscriptLine; forceVisible: boolean }) {
  const ref = useRef<HTMLLIElement>(null)
  const [entered, setEntered] = useState(false)
  // Derived, not set in the effect: reduced motion shows chips at once.
  const seen = entered || forceVisible

  useEffect(() => {
    if (forceVisible || entered) return
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      setEntered(true)
      return
    }
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setEntered(true)
          obs.disconnect()
        }
      },
      { rootMargin: '0px 0px -12% 0px' },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [forceVisible, entered])

  const isLayla = line.who === 'layla'
  return (
    <li ref={ref} className="min-w-0">
      <div className={`flex items-end gap-2.5 ${isLayla ? 'justify-start' : 'justify-end'}`}>
        <Bubble line={line} />
      </div>
      {line.tools.length > 0 && (
        <ul
          role="list"
          className={`mt-2.5 flex flex-wrap gap-1.5 ${isLayla ? 'justify-start pl-10' : 'justify-end'}`}
        >
          {line.tools.map((fn, j) => (
            <li
              key={fn}
              className={`inline-flex items-center gap-1.5 rounded-full border border-[#02C39A]/28 bg-[#02C39A]/10 px-3 py-1 text-xs font-semibold text-[#026B78] transition-[opacity,transform] duration-500 motion-reduce:transition-none ${
                seen ? 'translate-y-0 opacity-100' : 'translate-y-1.5 opacity-0'
              }`}
              style={{ transitionDelay: seen ? `${120 + j * 90}ms` : '0ms' }}
            >
              <span aria-hidden className="h-[5px] w-[5px] shrink-0 rounded-full bg-[#02C39A]" />
              {FN_LABEL[fn] ?? fn}
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

export function ToolWall() {
  const reduced = usePrefersReducedMotion()
  // Index of the furthest transcript line whose center-band has been
  // crossed downward; -1 = nothing crossed yet (SSR / top of section).
  const [active, setActive] = useState(-1)
  const lineRefs = useRef<(HTMLLIElement | null)[]>([])

  useEffect(() => {
    if (reduced) return
    const els = lineRefs.current.filter((el): el is HTMLLIElement => el !== null)
    if (els.length === 0) return
    if (typeof IntersectionObserver === 'undefined') {
      setActive(TRANSCRIPT.length - 1)
      return
    }
    // Lines currently inside the center band (usually 0 or 1, briefly 2).
    const inBand = new Set<number>()
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const idx = Number((e.target as HTMLElement).dataset.idx)
          if (Number.isNaN(idx)) continue
          if (e.isIntersecting) inBand.add(idx)
          else inBand.delete(idx)
        }
        if (inBand.size > 0) {
          // A line sits in the band — it is the active one. Taking the
          // max also settles the brief moment two short lines overlap.
          setActive(Math.max(...inBand))
          return
        }
        // Band is empty (gap between bubbles): infer direction from how
        // each line exited so the state reverses cleanly on scroll-up.
        for (const e of entries) {
          if (e.isIntersecting) continue
          const idx = Number((e.target as HTMLElement).dataset.idx)
          if (Number.isNaN(idx)) continue
          const bandTop = e.rootBounds?.top ?? 0
          if (e.boundingClientRect.bottom <= bandTop) {
            // Exited above the band → crossed downward, stays counted.
            setActive((c) => Math.max(c, idx))
          } else {
            // Exited below the band → scrolled back above this line.
            setActive((c) => (c >= idx ? idx - 1 : c))
          }
        }
      },
      { rootMargin: '-45% 0px -45% 0px' },
    )
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [reduced])

  const activeIdx = reduced ? TRANSCRIPT.length - 1 : active
  const lit = activeIdx >= 0 ? CUMULATIVE[activeIdx] : EMPTY

  return (
    <div>
      {/* ── Desktop: transcript column + sticky tool wall ─────── */}
      <div className="hidden gap-10 lg:grid lg:grid-cols-[1fr_1.05fr]">
        <ol role="list" aria-label="Sample call transcript" className="min-w-0">
          {TRANSCRIPT.map((line, i) => (
            <li
              key={i}
              ref={(el) => { lineRefs.current[i] = el }}
              data-idx={i}
              className={`flex items-end gap-2.5 py-10 transition-opacity duration-300 motion-reduce:transition-none ${
                line.who === 'layla' ? 'justify-start' : 'justify-end'
              } ${reduced || i === activeIdx ? 'opacity-100' : 'opacity-55'}`}
            >
              <Bubble line={line} />
            </li>
          ))}
        </ol>

        <div className="lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-2xl border border-[#0B2027]/10 bg-white/60 p-4 shadow-sm xl:p-5">
            <div className="mb-3 flex items-center justify-between">
              <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#026B78]">
                <span aria-hidden className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#02C39A]/40 [animation-duration:2.2s] motion-reduce:animate-none" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-[#02C39A]" />
                </span>
                Tools fired
              </span>
              <span className="text-sm font-bold tabular-nums text-[#0B2027]">
                {lit.size} <span className="font-medium text-gray-500">of 16</span>
              </span>
            </div>
            <ul role="list" className="grid grid-cols-4 gap-2.5">
              {TOOLS.map(({ fn, label, Icon }) => {
                const on = lit.has(fn)
                return (
                  <li
                    key={fn}
                    className={`flex flex-col items-center gap-1.5 rounded-xl border px-1 py-3 text-center transition-[border-color,background-color,opacity] duration-300 motion-reduce:transition-none ${
                      on ? 'border-[#02C39A]/60 bg-white' : 'border-gray-200 bg-[#FAF6EC] opacity-60'
                    }`}
                  >
                    {/* key swap remounts the icon so .pop-in replays on
                        every unlit→lit transition (and only then). */}
                    <span key={on ? 'lit' : 'dim'} className={on ? 'pop-in' : undefined}>
                      <Icon size={17} className="text-[#028090]" aria-hidden />
                    </span>
                    {/* Unlit label is gray-950, not ink: composited
                        through the cell's opacity-60 over cream, ink
                        lands at ~4.4:1 (AA fail at 11.5px) while
                        gray-950 holds ~5.3:1. */}
                    <span
                      className={`text-[11.5px] font-semibold leading-tight transition-colors duration-300 motion-reduce:transition-none ${
                        on ? 'text-[#0B2027]' : 'text-gray-950'
                      }`}
                    >
                      {label}
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        </div>
      </div>

      {/* ── Mobile: linear transcript with inline tool chips ──── */}
      <ol role="list" aria-label="Sample call transcript" className="space-y-7 lg:hidden">
        {TRANSCRIPT.map((line, i) => (
          <MobileLine key={i} line={line} forceVisible={reduced} />
        ))}
      </ol>
    </div>
  )
}
