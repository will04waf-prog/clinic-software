'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  CheckCircle2, Circle, Lock, ArrowRight, Sparkles, X, type LucideIcon,
} from 'lucide-react'

// ── Shape returned by /api/dashboard/setup-status ──────────────────
interface SetupStatus {
  tier: 'starter' | 'professional' | 'scale'
  tierName: string
  bookingSlug: string | null
  capabilities: { aiTwin: boolean; laylaVoice: boolean }
  signals: {
    hasServices: boolean
    hasHours: boolean
    bookingEnabled: boolean
    hasContacts: boolean
    smsLive: boolean
    aiTwinTrained: boolean
    hasPhoneNumber: boolean
    hasFaqs: boolean
    baaAttested: boolean
    laylaLive: boolean
  }
}

interface Step {
  key: string
  title: string
  description: string
  href: string
  done: boolean
}

interface Group {
  key: string
  title: string
  blurb: string
  icon: LucideIcon
  locked: boolean
  /** Plan the owner must be on to unlock a locked group. */
  unlockPlan?: string
  steps: Step[]
}

const DISMISS_KEY = 'tarhunna:setup-upsell-dismissed'

/**
 * "Get Layla live" — the tier-aware activation guide at the top of the
 * dashboard. It reads the org's real setup signals and walks the owner
 * through the shortest path to value: a bookable calendar first, then
 * the AI Twin (Pro/Scale), then Layla on the phone (Scale).
 *
 * Steps above the org's tier render as a locked group with an upgrade
 * nudge instead of dead-end CTAs. Once every step the org *can* do is
 * done, the full checklist disappears; if locked tiers remain it leaves
 * a slim, dismissible upsell.
 *
 * Fetches once on mount. Failures are silent — the dashboard must keep
 * rendering — exactly like the phone-number banner it sits above.
 */
export function SetupGuide() {
  const [status, setStatus] = useState<SetupStatus | null>(null)
  const [dismissedUpsell, setDismissedUpsell] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/dashboard/setup-status', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => { if (!cancelled && body?.signals) setStatus(body as SetupStatus) })
      .catch(() => { /* silent — the guide just won't render */ })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    try { setDismissedUpsell(localStorage.getItem(DISMISS_KEY) === '1') } catch { /* ignore */ }
  }, [])

  if (!status) return null

  const { signals: s, capabilities: caps } = status
  const groups = buildGroups(status)

  // Progress is measured only over steps the org can actually act on —
  // locked (higher-tier) groups don't count against them.
  const actionable = groups.filter((g) => !g.locked).flatMap((g) => g.steps)
  const doneCount = actionable.filter((st) => st.done).length
  const totalCount = actionable.length
  const allActionableDone = doneCount === totalCount
  const hasLockedGroups = groups.some((g) => g.locked)

  // Fully activated for their tier, nothing left to upsell → step aside.
  if (allActionableDone && !hasLockedGroups) return null

  // Fully activated, but higher tiers exist → slim, dismissible upsell.
  if (allActionableDone && hasLockedGroups) {
    if (dismissedUpsell) return null
    const nextLocked = groups.find((g) => g.locked)!
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-[#02C39A]/30 bg-[#F5EFE1] px-5 py-4">
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#02C39A]/15 text-[#028090]">
          <Sparkles className="h-4.5 w-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[#14241d]">
            You&apos;re fully set up on {status.tierName}.
          </p>
          <p className="mt-0.5 text-xs text-gray-600">
            {nextLocked.title} is available on {nextLocked.unlockPlan}.
          </p>
        </div>
        <Link
          href="/settings/billing"
          className="shrink-0 whitespace-nowrap rounded-full bg-[#028090] px-4 py-2 text-xs font-semibold text-white hover:bg-[#026B78] transition-colors"
        >
          Upgrade
        </Link>
        <button
          onClick={() => { try { localStorage.setItem(DISMISS_KEY, '1') } catch { /* ignore */ }; setDismissedUpsell(true) }}
          aria-label="Dismiss"
          className="shrink-0 text-gray-400 hover:text-gray-600"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    )
  }

  return (
    <section className="rounded-2xl border border-[#02C39A]/25 bg-[#F5EFE1] p-6">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-[#02C39A]/40 bg-[#02C39A]/10 px-3 py-1">
            <Sparkles className="h-3.5 w-3.5 text-[#14241d]" />
            <span className="text-xs font-semibold uppercase tracking-wider text-[#14241d]">Get Layla live</span>
          </div>
          <h3 className="mt-2 text-lg font-bold text-[#14241d]">Finish setting up your front desk</h3>
          <p className="mt-1 text-sm text-gray-600">
            A few steps stand between you and Layla answering your clinic&apos;s calls.
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-white px-3 py-1 text-xs font-semibold text-[#028090] ring-1 ring-[#02C39A]/30">
          {doneCount} of {totalCount} done
        </span>
      </div>

      {/* Progress bar over actionable steps. */}
      <div className="mb-6 h-1.5 w-full overflow-hidden rounded-full bg-white">
        <div
          className="h-full rounded-full bg-[#02C39A] transition-all duration-500"
          style={{ width: `${totalCount ? Math.round((doneCount / totalCount) * 100) : 0}%` }}
        />
      </div>

      <div className="space-y-5">
        {groups.map((group) => (
          <GroupBlock key={group.key} group={group} />
        ))}
      </div>
    </section>
  )
}

function GroupBlock({ group }: { group: Group }) {
  const Icon = group.icon
  const groupDone = group.steps.filter((s) => s.done).length

  return (
    <div className={group.locked ? 'opacity-95' : undefined}>
      <div className="mb-2.5 flex items-center gap-2">
        <span className={`inline-flex h-7 w-7 items-center justify-center rounded-lg ${
          group.locked ? 'bg-gray-200 text-gray-400' : 'bg-[#02C39A]/15 text-[#028090]'
        }`}>
          {group.locked ? <Lock className="h-3.5 w-3.5" /> : <Icon className="h-4 w-4" />}
        </span>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <h4 className="text-sm font-bold text-[#14241d]">{group.title}</h4>
          {group.locked ? (
            <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-gray-500 ring-1 ring-gray-200">
              {group.unlockPlan}
            </span>
          ) : (
            <span className="text-xs text-gray-400">{groupDone}/{group.steps.length}</span>
          )}
        </div>
      </div>

      {group.locked ? (
        <div className="ml-9 flex items-center justify-between gap-3 rounded-xl border border-dashed border-gray-300 bg-white/60 px-4 py-3">
          <p className="text-xs text-gray-500">{group.blurb}</p>
          <Link
            href="/settings/billing"
            className="shrink-0 whitespace-nowrap text-xs font-semibold text-[#028090] hover:text-[#026B78]"
          >
            Unlock on {group.unlockPlan} <ArrowRight className="inline h-3 w-3" />
          </Link>
        </div>
      ) : (
        <ul className="ml-9 space-y-2">
          {group.steps.map((step) => (
            <li
              key={step.key}
              className={`flex items-start gap-3 rounded-xl border p-3 ${
                step.done ? 'border-[#02C39A]/25 bg-white/50' : 'border-gray-200 bg-white'
              }`}
            >
              {step.done
                ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#02C39A]" />
                : <Circle className="mt-0.5 h-5 w-5 shrink-0 text-gray-300" />}
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-semibold ${
                  step.done ? 'text-gray-500 line-through decoration-[#02C39A]/40' : 'text-[#14241d]'
                }`}>
                  {step.title}
                </p>
                {!step.done && <p className="mt-0.5 text-xs text-gray-500 leading-snug">{step.description}</p>}
              </div>
              {!step.done && (
                <Link
                  href={step.href}
                  className="mt-0.5 shrink-0 whitespace-nowrap text-xs font-semibold text-[#028090] hover:text-[#026B78]"
                >
                  Set up <ArrowRight className="inline h-3 w-3" />
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * Turns raw setup signals + tier capabilities into the three grouped
 * step lists. Copy is owner-facing and benefit-led; hrefs point at the
 * exact settings surface for each step.
 */
function buildGroups(status: SetupStatus): Group[] {
  const { signals: s, capabilities: caps, bookingSlug } = status
  const bookingHref = '/settings/booking'

  const foundation: Group = {
    key: 'foundation',
    title: 'Build your booking engine',
    blurb: 'The essentials every clinic needs to take bookings.',
    icon: Sparkles,
    locked: false,
    steps: [
      {
        key: 'services',
        title: 'Add your services',
        description: 'List the treatments you offer with prices so clients can book them.',
        href: bookingHref,
        done: s.hasServices,
      },
      {
        key: 'hours',
        title: 'Set your provider hours',
        description: "Tell Layla when you're open so she only books real availability.",
        href: bookingHref,
        done: s.hasHours,
      },
      {
        key: 'booking',
        title: 'Publish your booking page',
        description: 'Turn on the public page clients use to book themselves, 24/7.',
        href: bookingHref,
        done: s.bookingEnabled,
      },
      {
        key: 'contacts',
        title: 'Bring in your contacts',
        description: 'Import your existing client list so follow-ups can start right away.',
        href: '/import-contacts',
        done: s.hasContacts,
      },
      {
        key: 'sms',
        title: 'Turn on text messaging',
        description: 'Let Tarhunna confirm bookings and send reminders by SMS.',
        href: '/settings',
        done: s.smsLive,
      },
    ],
  }

  const aiTwin: Group = {
    key: 'ai-twin',
    title: 'Train your AI Twin',
    blurb: "Teach the AI to text clients back in your clinic's own voice.",
    icon: Sparkles,
    locked: !caps.aiTwin,
    unlockPlan: 'Professional',
    steps: [
      {
        key: 'twin',
        title: 'Add voice examples',
        description: 'Give the AI a few of your real replies so it learns your tone.',
        href: '/ai-twin',
        done: s.aiTwinTrained,
      },
    ],
  }

  const voice: Group = {
    key: 'voice',
    title: 'Put Layla on the phone',
    blurb: 'Give Layla a number and let her answer every call, day or night.',
    icon: Sparkles,
    locked: !caps.laylaVoice,
    unlockPlan: 'Scale',
    steps: [
      {
        key: 'phone',
        title: "Get Layla's phone number",
        description: 'Provision the number Layla answers, then forward your clinic line to it.',
        href: '/settings/call-agent',
        done: s.hasPhoneNumber,
      },
      {
        key: 'faqs',
        title: 'Add your FAQs',
        description: 'Answer the questions clients ask most so Layla replies accurately.',
        href: '/settings/faqs',
        done: s.hasFaqs,
      },
      {
        key: 'live',
        title: 'Turn Layla on',
        description: s.baaAttested
          ? "Your BAA is signed — flip the switch to send Layla live."
          : 'Review the BAA and switch Layla live to start answering calls.',
        href: '/settings/call-agent',
        done: s.laylaLive,
      },
    ],
  }

  return [foundation, aiTwin, voice]
}
