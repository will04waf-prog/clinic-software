import { Sparkles, Clock } from 'lucide-react'
import type { MorningResponse } from './types'

/**
 * Variant A hero: AI morning brief sentence styled as a magazine
 * pull-quote. Spans with k:'hl' are italic teal (highlighted lead /
 * consult references); spans with k:'num' are mint-underlined
 * (key figures).
 *
 * Sentence is templated server-side from real numbers — visually
 * indistinguishable from an LLM call. Swapping the templater for a
 * real Anthropic call is a follow-up commit.
 */

interface Props {
  brief: MorningResponse['brief']
  generatedAt: string
}

function generatedLabel(iso: string) {
  const d = new Date(iso)
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

export function BriefHero({ brief, generatedAt }: Props) {
  return (
    <section className="relative pl-0.5 pt-2 pb-1">
      {/* The single decorative gradient on the screen. */}
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
            <Sparkles className="h-3 w-3" fill="currentColor" />
            AI morning brief
          </span>
          <span className="inline-flex items-center gap-1.5 text-[12.5px] text-[#7E8C90]">
            <Clock className="h-3.5 w-3.5" />
            Generated {generatedLabel(generatedAt)}
          </span>
        </div>

        <p
          className="max-w-[1040px] text-[#14241D]"
          style={{
            fontFamily: 'var(--font-newsreader), Newsreader, Georgia, serif',
            fontSize: '28px',
            lineHeight: 1.42,
            fontWeight: 500,
            textWrap: 'pretty',
          }}
        >
          {brief.segments.map((seg, i) => {
            if (seg.k === 'hl') {
              return (
                <span key={i} className="italic" style={{ color: '#026B78' }}>
                  {seg.t}
                </span>
              )
            }
            if (seg.k === 'num') {
              return (
                <span
                  key={i}
                  className="font-semibold"
                  style={{
                    borderBottom: '2px solid #02C39A',
                    paddingBottom: '1px',
                  }}
                >
                  {seg.t}
                </span>
              )
            }
            return <span key={i}>{seg.t}</span>
          })}
        </p>
      </div>
    </section>
  )
}
