'use client'
import { useEffect, useState } from 'react'
import { Activity, AlertCircle, Info, Sparkles, TrendingDown, TrendingUp } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { VOICE_CLASS_LABEL, type VoiceExampleClass } from '@/lib/voice-profile'
import {
  UpgradeCardLocked,
  isLockedResponse,
  type LockedResponseBody,
} from '@/components/billing/upgrade-card-locked'

/**
 * Phase 2 W8 — Voice training health card.
 *
 * Reads /api/org/voice-health (rolling 30d window) and surfaces:
 *   - Per-class metrics: drafts, edit ratio, examples saved
 *   - Recommendations: which classes need more training examples,
 *     which banned phrases are noisy, voice-edit signal
 *
 * UX honesty: copy is descriptive, not causal. "Drafts with voice
 * are edited N% less" — never "voice reduces edits". The lift
 * comparison is observational; clinic owners deserve to see the
 * signal, not a marketing claim.
 *
 * Empty states are explicit:
 *   - no drafts in window → "No drafts yet" coach
 *   - drafts in window but no W7-tagged → "Older drafts predate
 *     voice tracking" coach
 *   - classes with <5 drafts → "Need 5+ drafts" inline hint
 */

const MIN_SIGNAL = 5 // kept in lockstep with voice-health.ts MIN_DRAFTS_FOR_SIGNAL

type RecommendationSeverity = 'info' | 'warn' | 'good'

interface Recommendation {
  kind: string
  severity: RecommendationSeverity
  title: string
  detail: string
  class?: VoiceExampleClass
}

interface ClassMetrics {
  class: VoiceExampleClass
  drafts_total: number
  drafts_resolved: number
  sent_unchanged: number
  sent_with_minor_edits: number
  sent_with_significant_edits: number
  sent_with_heavy_edits: number
  auto_sent: number
  rejected: number
  guardrail_failed: number
  avg_edit_ratio: number | null
  ratio_sample_size: number
  examples_saved: number
}

interface VoiceHealth {
  window_start_iso: string
  window_days: number
  drafts_in_window: number
  drafts_with_voice_tagged: number
  banned_phrase_hits: number
  voice_lift: {
    with_examples_avg_edit_ratio: number
    without_examples_avg_edit_ratio: number
    delta: number
    with_examples_sample_size: number
    without_examples_sample_size: number
  } | null
  per_class: ClassMetrics[]
  recommendations: Recommendation[]
}

export function AiVoiceHealthCard() {
  const [data, setData]       = useState<VoiceHealth | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [locked, setLocked]   = useState<LockedResponseBody | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch('/api/org/voice-health', { cache: 'no-store' })
        // Tier gate — 402 means Starter org; swap in the upgrade card.
        if (res.status === 402) {
          const body = await res.json().catch(() => null)
          if (isLockedResponse(body)) {
            if (!cancelled) setLocked(body)
            return
          }
        }
        if (!res.ok) throw new Error('Failed to load voice health')
        const json = (await res.json()) as VoiceHealth
        if (!cancelled) setData(json)
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load voice health')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  if (loading) {
    return (
      <CardShell>
        <p className="text-sm text-gray-400">Loading…</p>
      </CardShell>
    )
  }
  if (locked) {
    return (
      <UpgradeCardLocked
        requiredTier="professional"
        currentTier={locked.current_tier}
        capability="Voice health metrics"
        title="Voice health metrics are on Professional"
        bullets={[
          'Per-class edit-ratio tracking',
          'Voice-lift comparison (with vs without examples)',
          'Recommendations on which classes need more training',
        ]}
      />
    )
  }
  if (!data) {
    return (
      <CardShell>
        <p className="text-sm text-red-600">{error || 'Voice health is unavailable.'}</p>
      </CardShell>
    )
  }

  const noDraftsAtAll = data.drafts_in_window === 0
  const noTaggedData  = !noDraftsAtAll && data.drafts_with_voice_tagged === 0
  const classesWithVolume = data.per_class.filter(c => c.drafts_total > 0)
  const hasAnyClassWithSignal = classesWithVolume.some(c => c.avg_edit_ratio !== null)

  return (
    <CardShell>
      {/* Headline + window */}
      <div className="flex items-baseline justify-between">
        <p className="text-xs text-gray-500">
          Rolling {data.window_days}-day window
        </p>
        <p className="text-xs text-gray-400">
          {data.drafts_in_window} draft{data.drafts_in_window === 1 ? '' : 's'} ·
          {' '}{data.drafts_with_voice_tagged} tagged
        </p>
      </div>

      {noDraftsAtAll ? (
        <CoachBox
          title="No drafts yet"
          body="The AI Twin needs a few drafts before we can measure how well your voice training is working. Send some test inbounds or click the Draft button on a lead — health insights show up here once you have 5+ drafts in a class."
        />
      ) : noTaggedData ? (
        <CoachBox
          title="Older drafts predate voice tracking"
          body="Your existing drafts were generated before voice training launched. Per-class metrics will appear over the next 30 days as new drafts come in."
        />
      ) : (
        <>
          {/* Voice lift banner — descriptive, not causal */}
          {data.voice_lift && Math.abs(data.voice_lift.delta) >= 0.02 && (
            <VoiceLiftBanner lift={data.voice_lift} />
          )}

          {/* Per-class table */}
          {classesWithVolume.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <p className="font-medium text-gray-900">By message type</p>
                <p className="text-[10.5px] text-gray-400">
                  Sent unchanged · edited · rejected
                </p>
              </div>
              <ul className="space-y-1.5">
                {classesWithVolume.map(cm => (
                  <ClassRow key={cm.class} cm={cm} />
                ))}
              </ul>
              {!hasAnyClassWithSignal && (
                <p className="text-[11.5px] text-gray-500 italic">
                  Each class needs at least {MIN_SIGNAL} sent or edited drafts before we show an edit % — keep going.
                </p>
              )}
            </div>
          )}

          {/* Recommendations */}
          {data.recommendations.length > 0 && (
            <div className="space-y-2 border-t border-gray-100 pt-4">
              <p className="font-medium text-gray-900">Recommendations</p>
              <ul className="space-y-2">
                {data.recommendations.map((r, i) => (
                  <li key={`${r.kind}-${r.class ?? ''}-${i}`}>
                    <RecommendationRow rec={r} />
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Banned phrase counter */}
          {data.banned_phrase_hits > 0 && (
            <p className="text-[11.5px] text-gray-500">
              Banned-phrase guardrail caught {data.banned_phrase_hits} draft
              {data.banned_phrase_hits === 1 ? '' : 's'} in this window.
            </p>
          )}
        </>
      )}
    </CardShell>
  )
}

function CardShell({ children }: { children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-[#02C39A]" />
          AI Twin · Voice training health
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5 text-sm">
        {children}
      </CardContent>
    </Card>
  )
}

function CoachBox({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg bg-[#FAF6EC]/60 border border-gray-200 px-3 py-3 text-[12.5px] text-gray-600">
      <p className="font-medium text-gray-900">{title}</p>
      <p className="mt-1">{body}</p>
    </div>
  )
}

function VoiceLiftBanner({ lift }: { lift: NonNullable<VoiceHealth['voice_lift']> }) {
  const isPositive = lift.delta > 0
  const pct = Math.max(1, Math.round(Math.abs(lift.delta) * 100))
  const Icon = isPositive ? TrendingDown : TrendingUp
  const tone = isPositive
    ? 'bg-[#02C39A]/10 border-[#02C39A]/30 text-[#04B08C]'
    : 'bg-[#B5710F]/10 border-[#B5710F]/30 text-[#B5710F]'
  return (
    <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-[12.5px] ${tone}`}>
      <Icon className="h-3.5 w-3.5 mt-0.5 shrink-0" />
      <div>
        <p className="font-semibold">
          {isPositive
            ? `Drafts using your voice are edited ${pct}% less`
            : `Drafts using your voice are edited ${pct}% MORE`}
        </p>
        <p className="mt-0.5 opacity-90">
          With examples: {prettyPct(lift.with_examples_avg_edit_ratio)} edited
          ({lift.with_examples_sample_size}) ·
          {' '}without: {prettyPct(lift.without_examples_avg_edit_ratio)} edited
          ({lift.without_examples_sample_size})
        </p>
      </div>
    </div>
  )
}

function ClassRow({ cm }: { cm: ClassMetrics }) {
  const ratio = cm.avg_edit_ratio
  const label = VOICE_CLASS_LABEL[cm.class]
  const ratioColor =
    ratio === null      ? 'text-gray-400'
    : ratio < 0.1       ? 'text-[#04B08C]'
    : ratio < 0.25      ? 'text-[#14241D]'
    : ratio < 0.5       ? 'text-[#B5710F]'
    :                     'text-red-600'

  const totalEdited = cm.sent_with_minor_edits + cm.sent_with_significant_edits + cm.sent_with_heavy_edits
  const ratioLabel = ratio === null
    ? (cm.ratio_sample_size === 0 ? 'No sends yet' : `Need ${MIN_SIGNAL}+ drafts`)
    : `${prettyPct(ratio)} edited`

  return (
    <li className="grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2">
      <div>
        <p className="text-[13px] font-medium text-gray-900">{label}</p>
        <p className="text-[11px] text-gray-500">
          {cm.drafts_total} draft{cm.drafts_total === 1 ? '' : 's'} ·
          {' '}{cm.examples_saved} example{cm.examples_saved === 1 ? '' : 's'} saved
        </p>
      </div>
      <div className="text-right">
        <p className={`text-[12.5px] font-semibold ${ratioColor}`}>{ratioLabel}</p>
        <p className="text-[10.5px] text-gray-400">
          {cm.sent_unchanged} · {totalEdited} · {cm.rejected + cm.guardrail_failed}
        </p>
      </div>
      <BarBucket cm={cm} />
    </li>
  )
}

function BarBucket({ cm }: { cm: ClassMetrics }) {
  const total = cm.drafts_resolved
  if (total === 0) return <div className="w-20 h-1.5" />
  const seg = (n: number) => `${(n / total) * 100}%`
  const tooltip =
    `${cm.sent_unchanged} sent unchanged, ` +
    `${cm.sent_with_minor_edits} minor edits, ` +
    `${cm.sent_with_significant_edits} significant edits, ` +
    `${cm.sent_with_heavy_edits} heavy edits, ` +
    `${cm.auto_sent} auto-sent, ` +
    `${cm.rejected + cm.guardrail_failed} rejected or blocked`
  return (
    <div
      className="w-20 h-1.5 rounded-full overflow-hidden bg-gray-100 flex"
      title={tooltip}
      aria-label={tooltip}
    >
      <span className="bg-[#04B08C]"      style={{ width: seg(cm.sent_unchanged) }} />
      <span className="bg-[#02C39A]/60"   style={{ width: seg(cm.sent_with_minor_edits) }} />
      <span className="bg-[#B5710F]/70"   style={{ width: seg(cm.sent_with_significant_edits) }} />
      <span className="bg-red-500/80"     style={{ width: seg(cm.sent_with_heavy_edits) }} />
      <span className="bg-[#028090]/70"   style={{ width: seg(cm.auto_sent) }} />
      <span className="bg-gray-300"       style={{ width: seg(cm.rejected + cm.guardrail_failed) }} />
    </div>
  )
}

function RecommendationRow({ rec }: { rec: Recommendation }) {
  const Icon = rec.severity === 'warn'
    ? AlertCircle
    : rec.severity === 'good'
    ? Sparkles
    : Info
  const tone = rec.severity === 'warn'
    ? 'bg-[#B5710F]/10 border-[#B5710F]/30 text-[#B5710F]'
    : rec.severity === 'good'
    ? 'bg-[#02C39A]/10 border-[#02C39A]/30 text-[#04B08C]'
    : 'bg-[#0B2027]/5 border-gray-200 text-[#14241D]'

  return (
    <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 ${tone}`}>
      <Icon className="h-3.5 w-3.5 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-[12.5px] font-semibold">{rec.title}</p>
        <p className="text-[12px] mt-0.5 opacity-90">{rec.detail}</p>
      </div>
    </div>
  )
}

function prettyPct(x: number): string {
  // Floor very small positives to 1% so we don't show "0% edited"
  // when there's a genuinely tiny but non-zero average.
  const pct = Math.round(x * 100)
  if (x > 0 && pct === 0) return '<1%'
  return `${pct}%`
}
