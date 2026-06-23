import Link from 'next/link'
import { AlertCircle, NotepadText, Calendar } from 'lucide-react'
import { InitialAvatar } from './initial-avatar'
import type { UpNextCardData } from './types'

/**
 * Right-column "Up-Next" anchor card. Dark forest panel with a mint
 * glow bottom-right, showing the soonest consult today. Forest text
 * background, cream text, mint CTA. Mirrors the dark-anchor pattern
 * the landing page final-CTA uses, condensed into a card.
 */

interface Props {
  upNext: UpNextCardData | null
}

export function UpNextCard({ upNext }: Props) {
  if (!upNext) {
    return (
      <section className="relative overflow-hidden rounded-2xl bg-[#14241D] px-5 pb-5 pt-4 text-[#FAF6EC]">
        <p className="text-[11px] font-bold uppercase tracking-wide text-[#FAF6EC]/55">Up next</p>
        <div className="mt-6 flex flex-col items-center gap-3 py-2 text-center">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-[#02C39A]/15">
            <Calendar className="h-4 w-4 text-[#02C39A]" />
          </span>
          <div>
            <p className="text-[14px] font-semibold text-[#FAF6EC]">Nothing booked today</p>
            <p className="mt-0.5 text-[12px] text-[#FAF6EC]/65 max-w-[16rem]">
              Share your booking link to fill the calendar.
            </p>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="relative overflow-hidden rounded-2xl bg-[#14241D] px-[18px] pb-[18px] pt-[17px] text-[#FAF6EC]">
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-12 -right-12 h-44 w-44"
        style={{
          background: 'radial-gradient(closest-side, rgba(2,195,154,0.32), transparent 70%)',
        }}
      />
      {/* Layout matches the screenshots: eyebrow + live-dot on the same
          top line, then big serif time on its own row with the countdown
          chip to the right of it, then avatar + name + procedure, then
          the prep-note, then the CTA. */}
      <div className="relative flex flex-col gap-3.5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#FAF6EC]/55">Up next</p>
          <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-[#02C39A]">
            <span className="relative inline-flex h-[7px] w-[7px]">
              <span className="absolute inset-0 animate-ping rounded-full bg-[#02C39A] opacity-60" />
              <span className="relative h-[7px] w-[7px] rounded-full bg-[#02C39A]" />
            </span>
            {upNext.countdown}
          </span>
        </div>

        <p
          className="text-[#FAF6EC]"
          style={{
            fontFamily: 'var(--font-newsreader), Newsreader, Georgia, serif',
            fontSize: '36px',
            fontWeight: 600,
            lineHeight: 1,
          }}
        >
          {upNext.when}
        </p>

        <div className="flex items-center gap-3">
          <InitialAvatar initials={upNext.initials} tint={upNext.tint} size="md" />
          <div className="min-w-0">
            <p className="truncate text-[14px] font-bold text-[#FAF6EC]">{upNext.name}</p>
            <p className="truncate text-[12px] text-[#FAF6EC]/65">{upNext.proc}</p>
          </div>
        </div>

        {upNext.note && (
          <p className="inline-flex items-center gap-1.5 text-[12.5px] text-[#02C39A]">
            <AlertCircle className="h-3.5 w-3.5" fill="currentColor" />
            {upNext.note}
          </p>
        )}

        <Link
          href={upNext.href}
          className="mt-0.5 inline-flex w-full items-center justify-center gap-2 rounded-[10px] bg-[#02C39A] px-3 py-2.5 text-[13px] font-semibold text-[#0B2027] hover:bg-[#04B08C] transition-colors"
        >
          <NotepadText className="h-3.5 w-3.5" />
          Open consult
        </Link>
      </div>
    </section>
  )
}
