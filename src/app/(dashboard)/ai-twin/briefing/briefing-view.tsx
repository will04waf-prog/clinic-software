'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Sparkles,
  Shield,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  ArrowRight,
  Clock,
} from 'lucide-react'
import type { BriefingPayload } from '@/lib/ai-twin-briefing'
import {
  UpgradeCardLocked,
  isLockedResponse,
  type LockedResponseBody,
} from '@/components/billing/upgrade-card-locked'

/**
 * Client-side briefing view. Lazy fetches /api/dashboard/ai-twin-briefing
 * on mount with cancellation guard, renders skeleton/error/empty states,
 * then six narrative sections.
 */

function Skeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-20 rounded-2xl bg-[#FAF6EC] border border-[#02C39A]/15" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-20 rounded-xl bg-[#FAF6EC] border border-[#0B2027]/5" />
        ))}
      </div>
      <div className="h-40 rounded-2xl bg-[#FAF6EC] border border-[#0B2027]/5" />
      <div className="h-40 rounded-2xl bg-[#FAF6EC] border border-[#0B2027]/5" />
    </div>
  )
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <section className="rounded-2xl bg-[#FAF6EC] border border-[#B5710F]/30 p-5">
      <p className="text-[13px] font-semibold text-[#B5710F]">Briefing unavailable</p>
      <p className="mt-1 text-[12.5px] text-[#7E8C90]">{message}</p>
    </section>
  )
}

function EmptyState() {
  return (
    <section className="rounded-2xl bg-[#FAF6EC] border border-[#02C39A]/15 p-6">
      <div className="flex items-center gap-2 text-[#14241D]/55">
        <Sparkles className="h-4 w-4 text-[#02C39A]" />
        <p className="text-[11px] font-bold uppercase tracking-wide">No twin activity in 24h</p>
      </div>
      <p className="mt-3 text-[14px] text-[#14241D]">
        No AI Twin activity in the last 24 hours. The briefing will populate once your twin
        handles inbounds — see{' '}
        <Link href="/ai-drafts/review" className="font-medium text-[#028090] hover:text-[#026B78]">
          Review drafts
        </Link>
        .
      </p>
    </section>
  )
}

export function BriefingView() {
  const [data, setData] = useState<BriefingPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [locked, setLocked] = useState<LockedResponseBody | null>(null)

  const load = useCallback(async (signal: AbortSignal) => {
    setLoading(true)
    setError(null)
    setLocked(null)
    try {
      const res = await fetch('/api/dashboard/ai-twin-briefing', { cache: 'no-store', signal })
      // Tier gate — 402 means below Scale. Swap the briefing for the
      // upgrade card (no redirect; users land here from links).
      if (res.status === 402) {
        const body = await res.json().catch(() => null)
        if (isLockedResponse(body)) {
          if (!signal.aborted) setLocked(body)
          return
        }
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      const json = (await res.json()) as BriefingPayload
      if (!signal.aborted) setData(json)
    } catch (err) {
      if (signal.aborted) return
      const msg = err instanceof Error ? err.message : 'Failed to load briefing'
      console.error('[ai-twin-briefing] load error:', err)
      setError(msg)
    } finally {
      if (!signal.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const ctrl = new AbortController()
    void load(ctrl.signal)
    return () => ctrl.abort()
  }, [load])

  if (loading && !data && !locked) return <Skeleton />
  if (locked) {
    return (
      <div className="mx-auto w-full max-w-[640px] px-6 py-10 sm:px-10">
        <UpgradeCardLocked
          requiredTier="scale"
          currentTier={locked.current_tier}
          capability="AI Twin briefing"
          title="The 24h briefing is on Scale"
          bullets={[
            'See exactly what your AI Twin handled in the last 24 hours',
            'Safety triggers, voice-health delta, auto-send by class',
            'A 24-hour summary of every action your twin took',
          ]}
        />
      </div>
    )
  }
  if (error) return <ErrorBanner message={error} />
  if (!data) return null

  const ac = data.action_counts
  const totalActions =
    ac.auto_sent +
    ac.sent_unchanged +
    ac.edited +
    ac.rejected +
    ac.guardrail_failed +
    ac.pending_open
  const isEmpty = totalActions === 0 && data.safety_triggers.total_matched_inbounds === 0

  if (isEmpty) return <EmptyState />

  return (
    <div className="space-y-4">
      <NarrativeHero data={data} />
      <ActionGrid counts={data.action_counts} />
      <PendingSection data={data} />
      <SafetySection triggers={data.safety_triggers} />
      <VoiceDeltaSection delta={data.voice_health_delta} />
      <AutoSendByClassSection buckets={data.auto_send_by_class} />
    </div>
  )
}

// ── Narrative hero ────────────────────────────────────────────────

function NarrativeHero({ data }: { data: BriefingPayload }) {
  const ac = data.action_counts
  const sentTotal = ac.auto_sent + ac.sent_unchanged + ac.edited
  const safety = data.safety_triggers.total_matched_inbounds

  const parts: string[] = []
  if (sentTotal > 0) {
    parts.push(
      `${sentTotal} ${sentTotal === 1 ? 'reply went out' : 'replies went out'}` +
        (ac.auto_sent > 0 ? ` (${ac.auto_sent} autonomously)` : ''),
    )
  }
  if (ac.pending_open > 0) {
    parts.push(`${ac.pending_open} ${ac.pending_open === 1 ? 'draft is' : 'drafts are'} awaiting your review`)
  }
  if (safety > 0) {
    parts.push(`${safety} ${safety === 1 ? 'inbound was' : 'inbounds were'} held for safety`)
  }
  const summary = parts.length === 0
    ? 'No notable activity yet — your twin is on standby.'
    : parts.join(' · ') + '.'

  return (
    <section className="rounded-2xl bg-[#FAF6EC] border border-[#02C39A]/20 px-5 py-5">
      <div className="flex items-center gap-2">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[#02C39A]/15">
          <Sparkles className="h-3.5 w-3.5 text-[#02C39A]" />
        </span>
        <p className="text-[11px] font-bold uppercase tracking-wide text-[#14241D]/55">
          Last 24 hours
        </p>
      </div>
      <h2
        className="mt-3 text-[#14241D]"
        style={{
          fontFamily: 'var(--font-newsreader), Newsreader, Georgia, serif',
          fontSize: '22px',
          fontWeight: 600,
          lineHeight: 1.25,
        }}
      >
        {summary}
      </h2>
    </section>
  )
}

// ── Actions grid ──────────────────────────────────────────────────

type Tone = 'mint' | 'teal' | 'amber' | 'navy'

function ActionGrid({ counts }: { counts: BriefingPayload['action_counts'] }) {
  const cells: { label: string; value: number; tone: Tone }[] = [
    { label: 'Auto-sent',        value: counts.auto_sent,        tone: 'mint' },
    { label: 'Sent unchanged',   value: counts.sent_unchanged,   tone: 'mint' },
    { label: 'Edited',           value: counts.edited,           tone: 'teal' },
    { label: 'Rejected',         value: counts.rejected,         tone: 'amber' },
    { label: 'Guardrail blocked',value: counts.guardrail_failed, tone: 'amber' },
    { label: 'Safety held',      value: counts.safety_held,      tone: 'navy' },
  ]
  return (
    <section>
      <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[#14241D]/55">
        Actions taken
      </h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {cells.map(c => (
          <ActionCell key={c.label} {...c} />
        ))}
      </div>
    </section>
  )
}

function ActionCell({ label, value, tone }: { label: string; value: number; tone: Tone }) {
  const accent =
    tone === 'mint'  ? '#02C39A' :
    tone === 'teal'  ? '#028090' :
    tone === 'amber' ? '#B5710F' :
                       '#0B2027'
  return (
    <div className="rounded-xl bg-[#FAF6EC] border border-[#0B2027]/8 px-3 py-3">
      <p className="text-[10.5px] font-semibold uppercase tracking-wide text-[#14241D]/55">{label}</p>
      <p className="mt-1.5 text-[22px] font-semibold text-[#14241D]" style={{ lineHeight: 1 }}>
        {value}
        <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ backgroundColor: accent }} />
      </p>
    </div>
  )
}

// ── Pending section ───────────────────────────────────────────────

function PendingSection({ data }: { data: BriefingPayload }) {
  const pending = data.action_counts.pending_open
  if (pending === 0 && data.pending_top.length === 0) return null

  return (
    <section className="rounded-2xl bg-[#FAF6EC] border border-[#0B2027]/8 px-5 py-5">
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] font-semibold text-[#14241D]">
          Pending drafts awaiting review
          <span className="ml-2 inline-flex items-center rounded-full bg-[#028090]/10 px-2 py-0.5 text-[11px] font-medium text-[#028090]">
            {pending}
          </span>
        </h3>
        <Link
          href="/ai-drafts/review"
          className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#028090] hover:text-[#026B78]"
        >
          Review all
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      {data.pending_top.length === 0 ? (
        <p className="mt-3 text-[12.5px] text-[#7E8C90]">No open drafts to preview.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {data.pending_top.map(item => (
            <li key={item.id}>
              <Link
                href="/ai-drafts/review"
                className="block rounded-lg border border-[#0B2027]/8 bg-white/60 px-3 py-2.5 hover:border-[#028090]/40 hover:bg-white"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[13px] font-medium text-[#14241D]">
                    {item.contact_name ?? 'Unknown contact'}
                  </p>
                  <span className="inline-flex items-center gap-1 text-[11px] text-[#7E8C90]">
                    <Clock className="h-3 w-3" />
                    {formatAge(item.age_minutes)}
                  </span>
                </div>
                {item.inbound_preview && (
                  <p className="mt-1 line-clamp-2 text-[12px] text-[#14241D]/70">
                    {item.inbound_preview}
                  </p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function formatAge(minutes: number): string {
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

// ── Safety section ────────────────────────────────────────────────

function SafetySection({ triggers }: { triggers: BriefingPayload['safety_triggers'] }) {
  if (triggers.total_matched_inbounds === 0) {
    return (
      <section className="rounded-2xl bg-[#FAF6EC] border border-[#0B2027]/8 px-5 py-5">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-[#02C39A]" />
          <h3 className="text-[13px] font-semibold text-[#14241D]">Safety triggers by category</h3>
        </div>
        <p className="mt-2 text-[12.5px] text-[#7E8C90]">
          No safety-flagged inbounds in the last 24 hours.
        </p>
      </section>
    )
  }

  return (
    <section className="rounded-2xl bg-[#FAF6EC] border border-[#0B2027]/8 px-5 py-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-[#B5710F]" />
          <h3 className="text-[13px] font-semibold text-[#14241D]">Safety triggers by category</h3>
        </div>
        <p className="text-[11px] text-[#7E8C90]">
          {triggers.total_matched_inbounds} of {triggers.inbound_scanned} inbounds
          {triggers.truncated && ' (most recent 500)'}
        </p>
      </div>

      <ul className="mt-3 space-y-3">
        {triggers.by_category.map(bucket => (
          <li key={bucket.category} className="rounded-lg border border-[#0B2027]/8 bg-white/60 px-3 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-3.5 w-3.5 text-[#B5710F]" />
                <p className="text-[13px] font-medium text-[#14241D]">{bucket.label}</p>
              </div>
              <span className="inline-flex items-center rounded-full bg-[#B5710F]/10 px-2 py-0.5 text-[11px] font-semibold text-[#B5710F]">
                {bucket.count}
              </span>
            </div>
            {bucket.examples.length > 0 && (
              <ul className="mt-2 space-y-1">
                {bucket.examples.map(ex => (
                  <li key={ex.message_id} className="text-[11.5px] text-[#14241D]/70">
                    <span className="font-medium text-[#14241D]/85">[{ex.label}]</span>{' '}
                    <span className="italic">{ex.preview || '(empty body)'}</span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

// ── Voice delta section ───────────────────────────────────────────

function VoiceDeltaSection({ delta }: { delta: BriefingPayload['voice_health_delta'] }) {
  return (
    <section className="rounded-2xl bg-[#FAF6EC] border border-[#0B2027]/8 px-5 py-5">
      <h3 className="text-[13px] font-semibold text-[#14241D]">Voice-health change</h3>
      {delta.direction === 'insufficient_sample' ? (
        <p className="mt-2 text-[12.5px] text-[#7E8C90]">
          Not enough edits in either window to compare ({delta.sample_size_current} current vs{' '}
          {delta.sample_size_prior} prior — need ≥3 each).
        </p>
      ) : (
        <VoiceDeltaBody delta={delta} />
      )}
    </section>
  )
}

function VoiceDeltaBody({ delta }: { delta: BriefingPayload['voice_health_delta'] }) {
  const current = delta.avg_edit_ratio_current ?? 0
  const prior = delta.avg_edit_ratio_prior ?? 0
  const diff = current - prior
  const pctNow = Math.round(current * 100)
  const pctThen = Math.round(prior * 100)
  const arrow =
    delta.direction === 'up'   ? <ArrowUpRight   className="h-3.5 w-3.5 text-[#B5710F]" /> :
    delta.direction === 'down' ? <ArrowDownRight className="h-3.5 w-3.5 text-[#02C39A]" /> :
                                 <Minus          className="h-3.5 w-3.5 text-[#7E8C90]" />
  const color =
    delta.direction === 'up'   ? 'text-[#B5710F]' :
    delta.direction === 'down' ? 'text-[#02C39A]' :
                                 'text-[#7E8C90]'

  const verb =
    delta.direction === 'up'   ? 'edited more' :
    delta.direction === 'down' ? 'edited less' :
                                 'roughly flat'

  return (
    <div className="mt-2 space-y-2">
      <p className="text-[13px] text-[#14241D]">
        <span className={`inline-flex items-center gap-1 font-semibold ${color}`}>
          {arrow}
          Drafts {verb}
        </span>{' '}
        <span className="text-[#14241D]/75">
          — {pctNow}% avg edit ratio now vs {pctThen}% in the prior 24h (
          {(diff >= 0 ? '+' : '') + Math.round(diff * 100)}pp,{' '}
          {delta.sample_size_current} current / {delta.sample_size_prior} prior).
        </span>
      </p>
      <p className="text-[11px] italic text-[#7E8C90]">
        Observational, not causal — sample sizes are small over 24h.
      </p>
    </div>
  )
}

// ── Auto-send by class ────────────────────────────────────────────

function AutoSendByClassSection({ buckets }: { buckets: BriefingPayload['auto_send_by_class'] }) {
  return (
    <section className="rounded-2xl bg-[#FAF6EC] border border-[#0B2027]/8 px-5 py-5">
      <h3 className="text-[13px] font-semibold text-[#14241D]">Auto-send by class</h3>
      {buckets.length === 0 ? (
        <p className="mt-2 text-[12.5px] text-[#7E8C90]">
          No autonomous sends in the last 24 hours.
        </p>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          {buckets.map(b => (
            <span
              key={b.class}
              className="inline-flex items-center gap-2 rounded-full border border-[#02C39A]/25 bg-white/60 px-3 py-1 text-[12px]"
            >
              <span className="text-[#14241D]/75">{b.label}</span>
              <span className="inline-flex items-center rounded-full bg-[#02C39A]/15 px-2 py-0.5 text-[11px] font-semibold text-[#04B08C]">
                {b.count}
              </span>
            </span>
          ))}
        </div>
      )}
    </section>
  )
}
