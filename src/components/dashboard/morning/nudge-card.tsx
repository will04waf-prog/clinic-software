'use client'
import { useState } from 'react'
import { Sparkles, Zap, Send, Inbox } from 'lucide-react'
import { FEATURES } from '@/lib/features'
import type { NudgeCardData } from './types'

/**
 * Single AI nudge card. Mint-tinted background, sparkle icon, one
 * insight + a primary mint-button action + a ghost dismiss.
 *
 * Phase 1: rule-based (server picks from a bank). The "Set up
 * reminders" / "Open inbox" / "Send follow-ups" actions don't
 * navigate yet — they'd land on future flow-specific routes. For now
 * they're best-effort hrefs that point at the closest existing page.
 */

const ICONS: Record<string, React.ComponentType<{ className?: string; fill?: string }>> = {
  sparkles: Sparkles,
  sparkle: Sparkles,
  lightning: Zap,
  zap: Zap,
  send: Send,
  inbox: Inbox,
}

const HREF_FOR_ICON: Record<string, string> = {
  inbox: '/leads',
  send: '/leads?filter=unread',
  sparkles: '/automations',
  sparkle: '/automations',
  lightning: '/automations',
  zap: '/automations',
}

interface Props {
  nudge: NudgeCardData | null
}

export function NudgeCard({ nudge }: Props) {
  const [dismissed, setDismissed] = useState(false)
  if (!nudge || dismissed) return null

  const PrimaryIcon = ICONS[nudge.primary.icon] ?? Sparkles
  const rawHref = HREF_FOR_ICON[nudge.primary.icon] ?? '/automations'
  // Automations is hidden behind a feature flag — send those nudges to
  // the dashboard instead of a route that bounces.
  const href = rawHref === '/automations' && !FEATURES.automations ? '/dashboard' : rawHref

  return (
    <section
      className="rounded-2xl border border-[#02C39A]/30 bg-[#02C39A]/[0.075] px-[17px] pb-[17px] pt-4"
    >
      <div className="flex items-start gap-3">
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-[#02C39A]">
          <Sparkles className="h-3.5 w-3.5 text-[#0B2027]" fill="currentColor" />
        </span>
        <div className="min-w-0">
          <p className="text-[13px] font-bold text-[#14241D]">
            {nudge.title} <span className="font-semibold text-[#04B08C]">· spotted a pattern</span>
          </p>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-[#0B2027]">{nudge.text}</p>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2 pl-10">
        <a
          href={href}
          className="inline-flex items-center gap-1.5 rounded-[9px] bg-[#02C39A] px-3 py-1.5 text-[12.5px] font-semibold text-[#0B2027] hover:bg-[#04B08C] transition-colors"
        >
          <PrimaryIcon className="h-3.5 w-3.5" fill="currentColor" />
          {nudge.primary.label}
        </a>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="rounded-[9px] px-3 py-1.5 text-[12.5px] font-semibold text-[#4A5A60] hover:bg-[#0B2027]/5 transition-colors"
        >
          {nudge.secondary.label}
        </button>
      </div>
    </section>
  )
}
