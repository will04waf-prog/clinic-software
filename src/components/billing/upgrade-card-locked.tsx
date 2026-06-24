'use client'
import Link from 'next/link'
import { Lock, ArrowRight } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * Phase 2 tier gating — shared "this feature requires upgrade" surface.
 *
 * Rendered by every gated UI card and page when its underlying fetch
 * returns the 402 locked shape `{ locked: true, error: 'tier_required',
 * required_tier, current_tier, capability, upgrade_url }`. The component
 * takes ZERO tier-specific imports — each caller passes `requiredTier`
 * explicitly. Honest copy: it explains WHAT unlocks at the tier, never
 * "click here for premium magic".
 *
 * Brand accents: Professional uses #028090 (teal), Scale uses #02C39A
 * (mint — the AI Twin brand color used across the dashboard, pricing
 * matrix, and unlocked-state cards). Amber #B5710F is reserved for
 * safety warnings, NOT tier promotion. Button text is ivory #FAF6EC
 * on the accent for WCAG AA contrast.
 */

export type RequiredTier = 'professional' | 'scale'

export interface UpgradeCardLockedProps {
  requiredTier: RequiredTier
  /** Effective tier the org is currently on (from the 402 body). Optional — when omitted we just say "your plan". */
  currentTier?: string | null
  /** Human-readable capability name, e.g. "Voice training", "Autonomous send". */
  capability: string
  /** Optional override for the headline. Defaults to "{capability} is on {Tier}". */
  title?: string
  /** Optional supporting body — explains the why-locked in one paragraph. */
  body?: string
  /** Optional bullet list of what unlocks at this tier. */
  bullets?: string[]
}

const TIER_DISPLAY: Record<RequiredTier, string> = {
  professional: 'Professional',
  scale:        'Scale',
}

const TIER_ACCENT: Record<RequiredTier, string> = {
  professional: '#028090',
  scale:        '#02C39A',
}

const TIER_ANCHOR: Record<RequiredTier, string> = {
  professional: '#professional',
  scale:        '#scale',
}

const DEFAULT_BULLETS: Record<RequiredTier, string[]> = {
  professional: [
    'Voice training — capture your real reply style',
    'Voice health metrics — see what the AI is learning',
    'AI Twin audit + flagging',
  ],
  scale: [
    'AI Twin replies to inbounds 24/7 within your guardrails',
    'Rollout dial + shadow mode for gradual trust',
    'Provider briefing every 24 hours',
  ],
}

export function UpgradeCardLocked({
  requiredTier,
  currentTier,
  capability,
  title,
  body,
  bullets,
}: UpgradeCardLockedProps) {
  const tierName = TIER_DISPLAY[requiredTier]
  const accent   = TIER_ACCENT[requiredTier]
  const anchor   = TIER_ANCHOR[requiredTier]
  const list     = bullets && bullets.length > 0 ? bullets : DEFAULT_BULLETS[requiredTier]
  const headline = title ?? `${capability} is on ${tierName}`
  // Honest copy — we no longer claim data "reappears the moment you
  // upgrade" because the UI doesn't actually surface stale data for
  // the user. The DB does retain it; that's a separate restore flow.
  const explanation = body ?? (
    `Your current plan${currentTier ? ` (${currentTier})` : ''} doesn't include ${capability.toLowerCase()}. ` +
    `Upgrade to ${tierName} to unlock the features below.`
  )

  return (
    <Card className="border-0 bg-[#14241D] shadow-md overflow-hidden">
      {/* Accent stripe — single horizontal bar at the top in the tier color. */}
      <div className="h-1 w-full" style={{ backgroundColor: accent }} aria-hidden />

      <CardHeader className="pt-5">
        <CardTitle className="flex items-center gap-2 text-[#FAF6EC]">
          <span
            className="inline-flex h-7 w-7 items-center justify-center rounded-full"
            style={{ backgroundColor: `${accent}22` }}
          >
            <Lock className="h-3.5 w-3.5" style={{ color: accent }} />
          </span>
          <span>{headline}</span>
          <span
            className="ml-auto inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide"
            style={{ backgroundColor: `${accent}22`, color: accent }}
          >
            {tierName}
          </span>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4 text-sm">
        <p className="text-[12.5px] leading-relaxed text-[#FAF6EC]/75">
          {explanation}
        </p>

        <ul className="space-y-2">
          {list.map(item => (
            <li
              key={item}
              className="flex items-start gap-2 text-[12.5px] text-[#FAF6EC]/90"
            >
              <span
                className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: accent }}
                aria-hidden
              />
              <span>{item}</span>
            </li>
          ))}
        </ul>

        <div className="pt-2">
          <Link
            href={`/pricing${anchor}`}
            className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-semibold text-[#FAF6EC] transition-colors hover:brightness-110"
            style={{ backgroundColor: accent }}
          >
            Upgrade to {tierName}
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * Shape of the 402 locked-response body returned by every gated API
 * route. Cards branch on this with `isLockedResponse(json)` to decide
 * whether to render their normal UI or swap in <UpgradeCardLocked />.
 */
export interface LockedResponseBody {
  locked: true
  error: 'tier_required'
  required_tier: RequiredTier
  current_tier: string
  capability: string
  upgrade_url: string
}

export function isLockedResponse(json: unknown): json is LockedResponseBody {
  if (!json || typeof json !== 'object') return false
  const j = json as Record<string, unknown>
  return (
    j.locked === true &&
    j.error === 'tier_required' &&
    (j.required_tier === 'professional' || j.required_tier === 'scale') &&
    typeof j.current_tier === 'string' &&
    typeof j.capability === 'string'
  )
}

export default UpgradeCardLocked
