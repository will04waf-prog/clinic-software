'use client'

/**
 * HearLayla — the "hear her answer" audio chip under the hero demo-line
 * card. Zero-commitment proof: before a visitor decides whether to dial
 * the live demo number, they can hear the exact 8-second greeting Layla
 * plays when she picks up (public/layla-answers.mp3).
 *
 *   - The Audio element is created INSIDE the tap handler — iOS only
 *     unlocks playback for media born in a user gesture — and nothing is
 *     preloaded before that (the chip costs 0 bytes of audio until tapped).
 *   - 24 precomputed peaks render a static waveform on the server; a rAF
 *     loop (running ONLY while audio plays) reads audio.currentTime and
 *     tints the bars behind the playhead mint. Reduced-motion users get a
 *     thin progress line instead of animating bars — the audio itself
 *     still plays, it's content, not decoration.
 *   - On ended, the chip converts its right side into the real ask:
 *     "Now call her yourself →" as a tel: link, with a small replay
 *     button so the proof stays one tap away.
 *   - Coordination: dispatches `tarhunna:audio-start` (source
 *     'hear-layla') before playing, and pauses itself when any other
 *     component on the page dispatches the same event.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { Pause, Play, PhoneCall, RotateCcw } from 'lucide-react'

const AUDIO_SRC = '/layla-answers.mp3'
const AUDIO_EVENT = 'tarhunna:audio-start'
const SOURCE = 'hear-layla'
/** Fallback until the element reports a finite duration (asset is 8.05s). */
const FALLBACK_DURATION_S = 8.05
const MINT = '#02C39A'
/** Deep forest at low alpha — the "unplayed" bar color on cream. */
const BAR_DIM = 'rgba(20, 36, 29, 0.28)'

/** Precomputed amplitude peaks (0–1) of layla-answers.mp3, 24 buckets. */
const PEAKS = [
  0.98, 0.98, 0.91, 0.98, 0.99, 0.9, 0.65, 0.91, 0.75, 0.24, 0.43, 0.84,
  0.95, 0.75, 1.0, 0.74, 0.66, 0.68, 0.69, 0.8, 0.42, 0.67, 0.2, 0.18,
] as const

const TRANSCRIPT =
  'Thanks for calling Tarhunna Aesthetics, this is Layla. Just so you know, ' +
  'this call may be recorded. What can I help you with?'

type Phase = 'idle' | 'playing' | 'paused' | 'ended'

// prefers-reduced-motion as an external store: the server snapshot is
// false, so server markup and first client paint always match; React
// re-renders with the real preference right after hydration.
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'
function subscribeReducedMotion(onChange: () => void) {
  const mq = window.matchMedia(REDUCED_MOTION_QUERY)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}
function readReducedMotion() {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches
}
const serverReducedMotion = () => false

const PILL =
  'flex h-11 max-w-full items-center gap-3 rounded-full border border-[#02C39A]/40 bg-white/60 px-4 transition-colors'

export function HearLayla() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState(0) // 0–1 playhead position
  const reduceMotion = useSyncExternalStore(
    subscribeReducedMotion,
    readReducedMotion,
    serverReducedMotion,
  )
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const rafRef = useRef(0)

  const stopTicker = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
  }, [])

  // The rAF loop exists only between 'play' and 'pause'/'ended' — no
  // background work while the chip sits idle in the hero.
  const startTicker = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    const tick = () => {
      const a = audioRef.current
      if (a) {
        const dur =
          Number.isFinite(a.duration) && a.duration > 0
            ? a.duration
            : FALLBACK_DURATION_S
        setProgress(Math.min(a.currentTime / dur, 1))
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [])

  // Audio-coordination protocol: if anything else on the page starts
  // sound (e.g. the showcase video), yield immediately.
  useEffect(() => {
    const onOtherAudio = (e: Event) => {
      const detail = (e as CustomEvent<{ source?: string }>).detail
      if (detail?.source === SOURCE) return
      audioRef.current?.pause()
    }
    window.addEventListener(AUDIO_EVENT, onOtherAudio)
    return () => {
      window.removeEventListener(AUDIO_EVENT, onOtherAudio)
      cancelAnimationFrame(rafRef.current)
      audioRef.current?.pause()
      audioRef.current = null
    }
  }, [])

  const toggle = useCallback(() => {
    if (!audioRef.current) {
      // Created inside the gesture on purpose: iOS Safari only permits
      // playback on media elements constructed during a user tap.
      const a = new Audio(AUDIO_SRC)
      a.preload = 'auto'
      a.addEventListener('play', () => {
        setPhase('playing')
        startTicker()
      })
      a.addEventListener('pause', () => {
        // Natural end also fires 'pause'; the 'ended' handler runs after
        // and wins, so only record a user/coordination pause here.
        stopTicker()
        setPhase((p) => (p === 'ended' ? p : 'paused'))
      })
      a.addEventListener('ended', () => {
        stopTicker()
        setProgress(1)
        setPhase('ended')
      })
      audioRef.current = a
    }
    const audio = audioRef.current
    if (audio.paused) {
      if (audio.ended) {
        audioRef.current.currentTime = 0
        setProgress(0)
      }
      window.dispatchEvent(
        new CustomEvent(AUDIO_EVENT, { detail: { source: SOURCE } }),
      )
      audio.play().catch(() => {
        stopTicker()
        setPhase('idle')
      })
    } else {
      audio.pause()
    }
  }, [startTicker, stopTicker])

  // Index of the bar under the playhead: -1 = none yet, PEAKS.length =
  // every bar has been passed.
  const playheadBar =
    phase === 'idle'
      ? -1
      : phase === 'ended'
        ? PEAKS.length
        : Math.min(Math.floor(progress * PEAKS.length), PEAKS.length - 1)

  const waveform = (
    <span
      aria-hidden="true"
      className="relative flex h-6 shrink-0 items-center gap-[2px]"
    >
      {PEAKS.map((peak, i) => {
        const played = !reduceMotion && i <= playheadBar
        const isActive =
          !reduceMotion && phase === 'playing' && i === playheadBar
        return (
          <span
            key={i}
            className="rounded-full"
            style={{
              width: 2.5,
              height: Math.max(4, Math.round(peak * 22)),
              backgroundColor: played ? MINT : BAR_DIM,
              transform: isActive ? 'scaleY(1.3)' : undefined,
              transition: reduceMotion
                ? undefined
                : 'transform 120ms ease, background-color 120ms linear',
            }}
          />
        )
      })}
      {/* Reduced-motion progress: a thin line instead of animating bars. */}
      {reduceMotion && phase !== 'idle' && (
        <span
          className="absolute inset-x-0 bottom-0 h-[2px] overflow-hidden rounded-full"
          style={{ backgroundColor: BAR_DIM }}
        >
          <span
            className="absolute inset-y-0 left-0 rounded-full"
            style={{ backgroundColor: MINT, width: `${progress * 100}%` }}
          />
        </span>
      )}
    </span>
  )

  return (
    <div className="mx-auto mt-3 w-fit max-w-full">
      {phase === 'ended' ? (
        <div className={`${PILL} hl-fade-in`}>
          <button
            type="button"
            onClick={toggle}
            aria-label="Replay Layla's greeting"
            className="-ml-3 flex h-full min-w-[44px] shrink-0 cursor-pointer items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-[#028090]"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#02C39A]/15">
              <RotateCcw className="h-3.5 w-3.5 text-[#028090]" />
            </span>
          </button>
          {waveform}
          <a
            href="tel:+13019622856"
            className="-mr-4 flex h-full shrink-0 items-center gap-1.5 rounded-full pr-4 pl-1 text-sm font-bold whitespace-nowrap text-[#026B78] hover:text-[#014f59] focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-[#028090]"
          >
            <PhoneCall className="h-3.5 w-3.5" />
            Now call her yourself&thinsp;→
          </a>
        </div>
      ) : (
        <button
          type="button"
          onClick={toggle}
          aria-pressed={phase === 'playing'}
          aria-label={
            phase === 'playing'
              ? "Pause Layla's greeting"
              : "Play an 8-second recording of Layla answering the demo line"
          }
          className={`${PILL} cursor-pointer hover:border-[#02C39A]/70 hover:bg-white/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#028090]`}
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#02C39A]/15">
            {phase === 'playing' ? (
              <Pause className="h-3.5 w-3.5 fill-current text-[#028090]" />
            ) : (
              <Play className="ml-px h-3.5 w-3.5 fill-current text-[#028090]" />
            )}
          </span>
          {waveform}
          <span className="text-sm font-semibold whitespace-nowrap text-[#14241D]">
            Hear her answer <span className="text-gray-500">· 0:08</span>
          </span>
        </button>
      )}
      {/* Screen-reader transcript of the recording. */}
      <p className="sr-only">
        Transcript of the recording: &ldquo;{TRANSCRIPT}&rdquo;
      </p>
    </div>
  )
}
