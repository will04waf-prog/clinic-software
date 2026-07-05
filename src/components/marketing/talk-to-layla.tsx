'use client'

/**
 * TalkToLayla — the in-browser "talk to her right here" live web call,
 * a quiet one-line affordance for desktop researchers. The hero's tel:
 * card is the strongest proof on the page for a phone in a hand; on a
 * desktop it's dead weight. This gives mouse-and-keyboard visitors the
 * same proof: a real, interruptible conversation with the exact
 * assistant that answers (301) 962-2856.
 *
 *   - page.tsx only renders this component when VAPI_PUBLIC_KEY is set
 *     (a server component reads the env at build time), so the offer
 *     row is in the server HTML from the first byte — no post-hydration
 *     reveal, no layout shift under the visitor's finger.
 *   - Everything expensive is gesture-initiated: the tap POSTs for a
 *     call grant (per-IP + global rate limits, 180s hard cap minted
 *     server-side), and only THEN dynamic-imports @vapi-ai/web — zero
 *     SDK bytes and no mic permission until a visitor actually asks.
 *   - Live state: a 112px orb (mint core, teal halo). Idle breathing is
 *     a CSS keyframe (ttl-orb-breathe, compositor-thread); Layla's
 *     voice adds up to 1.25× scale via a framer spring fed by the SDK's
 *     volume-level events. Reduced motion: static orb, spring bypassed.
 *   - Rate-limited (429) and error/mic-denied paths both land on the
 *     phone line — the fallback that always works.
 *   - Coordination: dispatches `tarhunna:audio-start` (source
 *     'talk-to-layla') before connecting, and hangs up quietly (back to
 *     the offer, no sales pitch for an aborted call) if any other
 *     component on the page starts sound.
 */

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion, useSpring } from 'framer-motion'
import { PhoneCall } from 'lucide-react'
import type Vapi from '@vapi-ai/web'

const AUDIO_EVENT = 'tarhunna:audio-start'
const SOURCE = 'talk-to-layla'
const DEMO_TEL_HREF = 'tel:+13019622856'
const DEMO_TEL_DISPLAY = '(301) 962-2856'
/** Client-side net over the server-granted maxDurationSeconds cap. */
const MAX_CALL_SECONDS = 180

/** Shape of a successful POST /api/demo-web-call response. */
type CallGrant = {
  publicKey: string
  assistantId: string
  overrides: {
    maxDurationSeconds: number
    silenceTimeoutSeconds: number
  }
}

type Phase =
  | 'offer' // the one-line text button
  | 'connecting'
  | 'live'
  | 'busy' // 429 — point at the phone line
  | 'ended' // call finished — the conversion moment
  | 'error' // mic denied / SDK or handshake failure

/** Give the handshake this long to produce call-start before bailing. */
const CONNECT_TIMEOUT_MS = 20_000

function formatElapsed(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

const FOCUS_RING =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#028090]'

/** Block-level tel link used by the busy and error fallbacks. */
function PhoneLineLink() {
  return (
    <a
      href={DEMO_TEL_HREF}
      className={`inline-flex min-h-[44px] items-center gap-1.5 px-2 text-sm font-bold text-[#026B78] underline-offset-4 hover:underline ${FOCUS_RING}`}
    >
      <PhoneCall aria-hidden="true" className="h-3.5 w-3.5" />
      {DEMO_TEL_DISPLAY}
    </a>
  )
}

interface TalkToLaylaProps {
  /** Personalized prospect demo: grants resolve this slug's assistant
   *  (see /api/demo-web-call), so Layla answers as THAT clinic. */
  slug?: string
  /** Override the offer-row button copy (default is the hero's line). */
  offerLabel?: string
}

export function TalkToLayla({ slug, offerLabel }: TalkToLaylaProps = {}) {
  const [phase, setPhase] = useState<Phase>('offer')
  const [elapsedS, setElapsedS] = useState(0)
  const reduceMotion = useReducedMotion() ?? false

  const vapiRef = useRef<Vapi | null>(null)
  const timerRef = useRef<number | null>(null)
  const connectTimeoutRef = useRef<number | null>(null)
  const startedAtRef = useRef(0)

  // Layla's voice → orb scale. volume-level arrives ~10×/s as 0–1; the
  // spring smooths it into an organic swell instead of a stepped jitter.
  const orbScale = useSpring(1, { stiffness: 260, damping: 26 })

  /** Idempotent full stop: timer, listeners, SDK, then the next phase. */
  const teardown = useCallback(
    (next: Phase) => {
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current)
        timerRef.current = null
      }
      if (connectTimeoutRef.current !== null) {
        window.clearTimeout(connectTimeoutRef.current)
        connectTimeoutRef.current = null
      }
      const vapi = vapiRef.current
      vapiRef.current = null
      if (vapi) {
        // Listeners first, so stop()'s own call-end can't re-enter.
        vapi.removeAllListeners()
        void vapi.stop().catch(() => {})
      }
      orbScale.jump(1)
      setPhase(next)
    },
    [orbScale],
  )

  // Audio-coordination protocol + unmount cleanup. If anything else on
  // the page starts sound mid-call, hang up back to the offer — an
  // aborted call hasn't earned the closing pitch.
  useEffect(() => {
    const onOtherAudio = (event: Event) => {
      const detail = (event as CustomEvent<{ source?: string }>).detail
      if (detail?.source === SOURCE) return
      if (vapiRef.current) teardown('offer')
    }
    window.addEventListener(AUDIO_EVENT, onOtherAudio)
    return () => {
      window.removeEventListener(AUDIO_EVENT, onOtherAudio)
      if (timerRef.current !== null) window.clearInterval(timerRef.current)
      if (connectTimeoutRef.current !== null)
        window.clearTimeout(connectTimeoutRef.current)
      const vapi = vapiRef.current
      vapiRef.current = null
      if (vapi) {
        vapi.removeAllListeners()
        void vapi.stop().catch(() => {})
      }
    }
  }, [teardown])

  const startTimer = useCallback(() => {
    startedAtRef.current = Date.now()
    setElapsedS(0)
    if (timerRef.current !== null) window.clearInterval(timerRef.current)
    timerRef.current = window.setInterval(() => {
      const s = Math.floor((Date.now() - startedAtRef.current) / 1000)
      setElapsedS(s)
      // Belt over the server-minted cap: Vapi ends the call at
      // maxDurationSeconds; if that signal is ever lost, hang up local.
      if (s >= MAX_CALL_SECONDS && vapiRef.current) {
        void vapiRef.current.stop().catch(() => {})
      }
    }, 1000)
  }, [])

  const beginCall = useCallback(async () => {
    setPhase('connecting')
    try {
      const res = await fetch('/api/demo-web-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(slug ? { slug } : {}),
      })
      if (res.status === 429) {
        setPhase('busy')
        return
      }
      if (!res.ok) {
        setPhase('error')
        return
      }
      const grant = (await res.json()) as CallGrant

      // The SDK (plus its Daily/WebRTC dependency) loads only now,
      // inside the gesture — the offer button itself costs zero bytes.
      const { default: VapiClient } = await import('@vapi-ai/web')
      const vapi = new VapiClient(grant.publicKey)
      vapiRef.current = vapi

      vapi.on('call-start', () => {
        if (connectTimeoutRef.current !== null) {
          window.clearTimeout(connectTimeoutRef.current)
          connectTimeoutRef.current = null
        }
        startTimer()
        setPhase('live')
      })
      vapi.on('call-end', () => teardown('ended'))
      vapi.on('error', () => teardown('error'))
      vapi.on('volume-level', (volume: number) => {
        orbScale.set(1 + Math.min(Math.max(volume, 0), 1) * 0.25)
      })

      // Ask every other player on the page to yield before Layla speaks.
      window.dispatchEvent(
        new CustomEvent(AUDIO_EVENT, { detail: { source: SOURCE } }),
      )

      // Watchdog: if the handshake never produces call-start (event
      // missed, network stall), don't strand the visitor on a spinner
      // while a call may be live and billing — kill it and fall back.
      connectTimeoutRef.current = window.setTimeout(() => {
        connectTimeoutRef.current = null
        if (vapiRef.current === vapi) teardown('error')
      }, CONNECT_TIMEOUT_MS)

      await vapi.start(grant.assistantId, grant.overrides)

      // Teardown may have run while start() was in flight: the SDK's
      // stop() no-ops before its internal call object exists, so the
      // call can connect after we already "stopped" — a hot mic with no
      // UI. If this instance is no longer current, kill the orphan now
      // that the SDK has a call object to destroy.
      if (vapiRef.current !== vapi) {
        vapi.removeAllListeners()
        void vapi.stop().catch(() => {})
      }
    } catch {
      // Mic permission denied, SDK load failure, or a failed handshake.
      // If a coordination teardown already ran (ref cleared, phase
      // moved on), its outcome wins — don't stomp it with an error.
      if (vapiRef.current) {
        teardown('error')
      } else {
        setPhase((p) => (p === 'connecting' ? 'error' : p))
      }
    }
  }, [orbScale, slug, startTimer, teardown])

  return (
    <div className="ttl-fade-in mx-auto mt-3 flex w-fit max-w-full flex-col items-center text-center">
      {phase === 'offer' && (
        <button
          type="button"
          onClick={() => void beginCall()}
          aria-label="Start a live browser call with Layla — uses your microphone"
          className={`inline-flex min-h-[44px] cursor-pointer items-center px-2 text-sm font-semibold text-[#026B78] underline-offset-4 hover:underline ${FOCUS_RING}`}
        >
          {offerLabel ?? <>No phone handy? Talk to her right here&thinsp;&rarr;</>}
        </button>
      )}

      {phase === 'connecting' && (
        <div
          role="status"
          className="flex min-h-[44px] items-center gap-2 text-sm text-gray-500"
        >
          <span
            aria-hidden="true"
            className={`h-2 w-2 rounded-full bg-[#02C39A] ${reduceMotion ? '' : 'ttl-dot-pulse'}`}
          />
          Connecting&hellip;
        </div>
      )}

      {phase === 'live' && (
        <div className="ttl-fade-in flex flex-col items-center gap-3 py-2">
          {/* The orb: CSS breathing on the wrapper (decorative, killed by
              reduced-motion), voice-driven spring scale on the core. */}
          <div
            aria-hidden="true"
            className={`relative flex h-28 w-28 items-center justify-center ${reduceMotion ? '' : 'ttl-orb-breathe'}`}
          >
            <div
              className="absolute inset-0 rounded-full"
              style={{
                background:
                  'radial-gradient(circle, rgba(2, 128, 144, 0.40) 0%, rgba(2, 128, 144, 0.10) 55%, rgba(2, 128, 144, 0) 72%)',
              }}
            />
            <motion.div
              className="h-[72px] w-[72px] rounded-full"
              style={{
                scale: reduceMotion ? 1 : orbScale,
                background:
                  'radial-gradient(circle at 38% 30%, #7EEFC9 0%, #02C39A 52%, #028090 100%)',
                boxShadow: '0 8px 28px rgba(2, 131, 144, 0.35)',
              }}
            />
          </div>
          <p className="text-xs font-semibold tabular-nums text-gray-500">
            {formatElapsed(elapsedS)}
          </p>
          <p
            role="status"
            className="max-w-[280px] text-[13px] leading-snug text-gray-600"
          >
            You&apos;re talking to Layla — the same assistant that answers the
            phone line
          </p>
          <button
            type="button"
            onClick={() => teardown('ended')}
            className={`min-h-[44px] cursor-pointer rounded-full bg-[#14241D] px-7 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1F3830] ${FOCUS_RING}`}
          >
            End call
          </button>
        </div>
      )}

      {phase === 'busy' && (
        <div role="status" className="flex flex-col items-center gap-0.5 py-1">
          <p className="max-w-xs text-sm leading-relaxed text-gray-600">
            She&apos;s popular right now — the phone line&apos;s open:
          </p>
          <PhoneLineLink />
        </div>
      )}

      {phase === 'error' && (
        <div role="status" className="flex flex-col items-center gap-0.5 py-1">
          <p className="max-w-xs text-sm leading-relaxed text-gray-600">
            Mic blocked or the connection failed — the phone line always
            works:
          </p>
          <PhoneLineLink />
        </div>
      )}

      {phase === 'ended' && (
        <div className="ttl-fade-in flex flex-col items-center gap-3 py-2">
          <p
            role="status"
            className="max-w-xs text-sm leading-relaxed text-gray-700"
          >
            She just did that for a stranger on the internet. Imagine her on
            your clinic&apos;s line.
          </p>
          <Link
            href="/signup"
            className={`inline-flex min-h-[44px] items-center justify-center rounded-lg bg-gradient-brand px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-150 hover:scale-[1.02] ${FOCUS_RING}`}
          >
            Start free trial&thinsp;&rarr;
          </Link>
          <button
            type="button"
            onClick={() => void beginCall()}
            className={`min-h-[44px] cursor-pointer px-2 text-[13px] font-medium text-gray-500 underline-offset-4 hover:text-[#026B78] hover:underline ${FOCUS_RING}`}
          >
            call again
          </button>
        </div>
      )}
    </div>
  )
}
