'use client'
import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Bot, CheckCircle2, History, Loader2, Lock } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { VOICE_CLASS_LABEL, type VoiceExampleClass } from '@/lib/voice-profile'

/**
 * Phase 2 W9 — Autonomous send settings.
 *
 * Behavior gates the user explicitly opts into. UI design choices:
 *   - Master toggle is the only way to enable any auto-send.
 *   - Master OFF is visually heavy; ON is heavier and shows an
 *     amber warning explaining what the AI will do without review.
 *   - Per-class checkboxes are disabled until the class is eligible
 *     AND the master toggle is on.
 *   - Each class shows the trust signals: drafts resolved, avg edit
 *     %, examples saved — so the owner sees WHY a class is or isn't
 *     auto-send-ready.
 *   - "Recent autonomous sends" surfaces the last 5 so the owner can
 *     audit what the AI did without their review.
 */

interface EligibilityResult {
  eligible: boolean
  reason_code: string
  reason: string
}

interface PerClassStatus {
  class: VoiceExampleClass
  enabled_by_owner: boolean
  eligibility: EligibilityResult
  drafts_resolved: number
  ratio_sample_size: number
  avg_edit_ratio: number | null
  examples_saved: number
}

interface RecentAutoSend {
  id: string
  generated_at: string
  resolved_at: string | null
  draft_body_preview: string
  message_class: string | null
}

interface AutoSendSettings {
  enabled: boolean
  classes: VoiceExampleClass[]
  per_class: PerClassStatus[]
  recent_auto_sends: RecentAutoSend[]
  recent_banned_phrase_hits: number
  recent_banned_phrase_lookback_days: number
}

export function AiAutoSendCard() {
  const [data, setData]       = useState<AutoSendSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/org/auto-send-settings', { cache: 'no-store' })
      if (!res.ok) throw new Error('Failed to load auto-send settings')
      const json = (await res.json()) as AutoSendSettings
      setData(json)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load auto-send settings')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { load() }, [load])

  async function patchSettings(update: { enabled?: boolean; classes?: VoiceExampleClass[] }) {
    if (!data) return
    setSaving(true)
    setError('')
    // Optimistic — update local state then re-fetch from server.
    setData({
      ...data,
      enabled: update.enabled ?? data.enabled,
      classes: update.classes ?? data.classes,
      per_class: data.per_class.map(p => ({
        ...p,
        enabled_by_owner: update.classes ? update.classes.includes(p.class) : p.enabled_by_owner,
      })),
    })
    try {
      const res = await fetch('/api/org/auto-send-settings', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(update),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'Save failed')
      }
      // Re-fetch to refresh eligibility (turning master ON can flip per-class verdicts).
      await load()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed')
      await load()
    } finally {
      setSaving(false)
    }
  }

  function toggleMaster() {
    if (!data) return
    patchSettings({ enabled: !data.enabled })
  }

  function toggleClass(cls: VoiceExampleClass) {
    if (!data) return
    const next = data.classes.includes(cls)
      ? data.classes.filter(c => c !== cls)
      : [...data.classes, cls]
    patchSettings({ classes: next })
  }

  if (loading) {
    return (
      <CardShell>
        <p className="text-sm text-gray-400">Loading…</p>
      </CardShell>
    )
  }
  if (!data) {
    return (
      <CardShell>
        <p className="text-sm text-red-600">{error || 'Auto-send settings unavailable.'}</p>
      </CardShell>
    )
  }

  return (
    <CardShell>
      {/* ── Master toggle + warning ──────────────────────────────── */}
      <div className="rounded-lg border border-gray-200 bg-white p-3 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-gray-900 text-[13px]">Autonomous mode</p>
            <p className="text-[12px] text-gray-500 mt-0.5">
              When ON, the AI replies to inbound SMS on its own — without you
              reviewing — for the classes you enable below.
            </p>
          </div>
          <button
            type="button"
            onClick={toggleMaster}
            disabled={saving}
            aria-pressed={data.enabled}
            className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
              data.enabled ? 'bg-[#02C39A]' : 'bg-gray-300'
            }`}
          >
            <span
              className={`inline-block h-5 w-5 mt-0.5 rounded-full bg-white shadow transition-transform ${
                data.enabled ? 'translate-x-5' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>

        {data.enabled && data.classes.length === 0 && (
          <div className="flex items-start gap-2 rounded-lg bg-gray-100 border border-gray-200 px-3 py-2 text-[12px] text-gray-700">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold">No message types enabled yet</p>
              <p className="mt-0.5 opacity-90">
                Autonomous mode is on, but nothing will auto-send until you
                check at least one class below.
              </p>
            </div>
          </div>
        )}
        {data.enabled && data.classes.length > 0 && (
          <div className="flex items-start gap-2 rounded-lg bg-[#B5710F]/10 border border-[#B5710F]/30 px-3 py-2 text-[12px] text-[#B5710F]">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold">Autonomous sends are live</p>
              <p className="mt-0.5 opacity-90">
                The AI will reply on its own for {data.classes.length} message
                type{data.classes.length === 1 ? '' : 's'} — only when the
                class has cleared all trust thresholds. The safety blocklist
                (medical, pregnancy, minors, self-harm, cancel, complaint,
                legal, urgency, privacy) ALWAYS holds for human review.
                Disclosure footer is appended automatically.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ── Per-class allowlist ──────────────────────────────────── */}
      <div className="space-y-2">
        <p className="font-medium text-gray-900">By message type</p>
        <ul className="space-y-1.5">
          {data.per_class.map(pc => (
            <ClassRow
              key={pc.class}
              pc={pc}
              masterOn={data.enabled}
              saving={saving}
              onToggle={() => toggleClass(pc.class)}
            />
          ))}
        </ul>
      </div>

      {/* ── Recent autonomous sends (audit) ──────────────────────── */}
      <div className="space-y-2 border-t border-gray-100 pt-4">
        <div className="flex items-center gap-2">
          <History className="h-3.5 w-3.5 text-gray-500" />
          <p className="font-medium text-gray-900">Recent autonomous sends</p>
        </div>
        {data.recent_auto_sends.length === 0 ? (
          <p className="text-[11.5px] text-gray-400 italic">
            None yet. When the AI auto-sends a reply, it'll show up here.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {data.recent_auto_sends.map(rs => (
              <li key={rs.id} className="rounded-lg border border-gray-200 bg-white p-2.5">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="rounded-full bg-[#028090]/15 px-2 py-0.5 text-[10.5px] font-semibold text-[#028090]">
                    {rs.message_class ? VOICE_CLASS_LABEL[rs.message_class as VoiceExampleClass] ?? rs.message_class : 'unknown'}
                  </span>
                  <span className="text-[10.5px] text-gray-400">{relativeTime(rs.generated_at)}</span>
                </div>
                <p className="text-[12px] text-gray-700 whitespace-pre-line">{rs.draft_body_preview}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {data.recent_banned_phrase_hits > 0 && (
        <p className="text-[11.5px] text-[#B5710F]">
          Heads up: {data.recent_banned_phrase_hits} banned-phrase guardrail
          hit{data.recent_banned_phrase_hits === 1 ? '' : 's'} in the last
          {' '}{data.recent_banned_phrase_lookback_days} days. Auto-send is
          paused org-wide until clean.
        </p>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </CardShell>
  )
}

function CardShell({ children }: { children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-[#028090]" />
          AI Twin · Autonomous mode
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5 text-sm">
        {children}
      </CardContent>
    </Card>
  )
}

function ClassRow({
  pc, masterOn, saving, onToggle,
}: {
  pc: PerClassStatus
  masterOn: boolean
  saving: boolean
  onToggle: () => void
}) {
  const label = VOICE_CLASS_LABEL[pc.class]
  const eligible = pc.eligibility.eligible
  // Disable the checkbox unless master is on AND the class is eligible.
  // Already-checked allowlisted classes stay checkable (so the owner can opt out).
  const disabled = saving || (!eligible && !pc.enabled_by_owner) || !masterOn

  const ratioPct = pc.avg_edit_ratio !== null ? Math.round(pc.avg_edit_ratio * 100) : null

  return (
    <li className="rounded-lg border border-gray-200 bg-white p-3 space-y-1.5">
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={pc.enabled_by_owner}
          disabled={disabled}
          onChange={onToggle}
          className="mt-0.5 h-4 w-4 rounded border-gray-300 text-[#02C39A] focus:ring-[#02C39A]/40 disabled:opacity-40"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-[13px] font-medium text-gray-900">{label}</p>
            <StatusBadge eligible={eligible} masterOn={masterOn} enabled={pc.enabled_by_owner} />
          </div>
          <p className="text-[11px] text-gray-500 mt-0.5">
            {pc.ratio_sample_size} human-handled ·
            {' '}{ratioPct !== null ? `${ratioPct}% avg edit` : 'not enough data'} ·
            {' '}{pc.examples_saved} example{pc.examples_saved === 1 ? '' : 's'} saved
          </p>
          {!eligible && (
            <p className="text-[11px] text-gray-500 mt-1 italic">
              {pc.eligibility.reason}
            </p>
          )}
        </div>
      </div>
    </li>
  )
}

function StatusBadge({ eligible, masterOn, enabled }: { eligible: boolean; masterOn: boolean; enabled: boolean }) {
  if (!masterOn && enabled) {
    return (
      <span className="inline-flex items-center gap-0.5 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">
        <Lock className="h-2.5 w-2.5" /> Master off
      </span>
    )
  }
  if (eligible) {
    return (
      <span className="inline-flex items-center gap-0.5 rounded-full bg-[#02C39A]/15 px-1.5 py-0.5 text-[10px] font-semibold text-[#04B08C]">
        <CheckCircle2 className="h-2.5 w-2.5" /> Eligible
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-0.5 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">
      <Loader2 className="h-2.5 w-2.5" /> Not yet
    </span>
  )
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return 'just now'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}
