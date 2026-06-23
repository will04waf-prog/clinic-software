'use client'
import { useEffect, useState } from 'react'
import { BellRing, Hourglass, Zap } from 'lucide-react'
import { InitialAvatar } from './initial-avatar'
import type { MorningResponse } from './types'

/**
 * Variant B of the hero: a big "leads waiting on you" count with an
 * avatar stack and a Clear-the-queue CTA. Switched in via ?hero=waiting.
 *
 * The count animates 0 → N on mount (~620ms) unless the user has
 * prefers-reduced-motion set.
 */

interface Props {
  waiting: MorningResponse['waiting']
  generatedAt: string
}

function generatedLabel(iso: string) {
  const d = new Date(iso)
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

function useCountUp(target: number) {
  const [n, setN] = useState(target)
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) { setN(target); return }
    setN(0)
    const start = performance.now()
    const duration = 620
    let raf = 0
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / duration)
      setN(Math.round(target * (1 - Math.pow(1 - k, 3))))
      if (k < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target])
  return n
}

export function WaitingHero({ waiting, generatedAt }: Props) {
  const n = useCountUp(waiting.count)

  return (
    <section className="relative pl-0.5 pt-2 pb-1">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 -right-16 h-80 w-[30rem] opacity-90"
        style={{
          background: 'radial-gradient(closest-side, rgba(2,195,154,0.16), transparent 70%)',
        }}
      />

      <div className="relative flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#02C39A]/15 px-2.5 py-1 text-[11.5px] font-bold text-[#04B08C]">
            <BellRing className="h-3 w-3" fill="currentColor" />
            Needs you first
          </span>
          <span className="text-[12.5px] text-[#7E8C90]">as of {generatedLabel(generatedAt)}</span>
        </div>

        <div className="flex flex-wrap items-center gap-7">
          <div
            className="text-[#14241D]"
            style={{
              fontFamily: 'var(--font-newsreader), Newsreader, Georgia, serif',
              fontSize: '92px',
              fontWeight: 600,
              lineHeight: 0.82,
            }}
          >
            {n}
          </div>
          <div className="flex flex-col gap-1.5">
            <p className="text-[25px] font-semibold leading-snug text-[#14241D]">
              {waiting.count === 1 ? 'lead is waiting on you' : 'leads are waiting on you'}
            </p>
            <p className="max-w-[360px] text-[13.5px] text-[#4A5A60]">
              Oldest has been waiting {waiting.oldestLabel}. Average first reply this week: {waiting.avgFirstReplySeconds}s.
            </p>
            {waiting.avatars.length > 0 && (
              <div className="mt-1 flex">
                {waiting.avatars.map((a, i) => (
                  <span key={i} className={i === 0 ? '' : '-ml-2.5'}>
                    <InitialAvatar initials={a.initials} tint={a.tint} size="md" ring />
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="ml-auto flex flex-col gap-2.5">
            {waiting.oldestMinutes > 30 && (
              <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#B5710F]">
                <Hourglass className="h-4 w-4" fill="currentColor" />
                Oldest waiting {waiting.oldestLabel}
              </span>
            )}
            <a
              href="/leads"
              className="inline-flex items-center gap-2 self-end rounded-full bg-[#14241D] px-4 py-2 text-[13px] font-semibold text-[#FAF6EC] shadow-[0_6px_16px_-9px_rgba(20,36,29,0.7)] hover:bg-[#1E342A] transition-colors"
            >
              <Zap className="h-3.5 w-3.5" fill="currentColor" />
              Clear the queue
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}
