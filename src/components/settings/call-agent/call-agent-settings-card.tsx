'use client'

/**
 * Phase 5 W1 — call agent owner-facing config card.
 *
 * Loads /api/org/call-agent (which 402s for non-Scale orgs); on 402
 * swaps to <UpgradeCardLocked />. Otherwise renders the toggle +
 * mode + fallback number + greeting form.
 *
 * Hard-rule: call_agent_enabled cannot flip true unless
 * call_agent_baa_attested_at is set. The UI surfaces this as a
 * pre-condition card that must be checked first.
 */

import { useCallback, useEffect, useState } from 'react'
import { PhoneCall, AlertTriangle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { UpgradeCardLocked, isLockedResponse } from '@/components/billing/upgrade-card-locked'

interface CallAgentConfig {
  twilio_phone_number:        string | null
  call_agent_enabled:         boolean
  call_agent_mode:            'off' | 'after_hours' | 'always'
  call_agent_fallback_e164:   string | null
  call_agent_greeting:        string | null
  call_agent_assistant_id:    string | null
  call_agent_baa_attested_at: string | null
}

export function CallAgentSettingsCard() {
  const [config, setConfig]     = useState<CallAgentConfig | null>(null)
  const [locked, setLocked]     = useState<any | null>(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [saving, setSaving]     = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/org/call-agent', { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (res.status === 402 && isLockedResponse(json)) {
        setLocked(json)
        return
      }
      if (!res.ok) throw new Error(json.message ?? json.error ?? 'Could not load')
      setConfig(json)
    } catch (err: any) {
      setError(err?.message ?? 'Could not load')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { load() }, [load])

  async function patch(updates: Partial<{
    call_agent_enabled: boolean
    call_agent_mode: 'off' | 'after_hours' | 'always'
    call_agent_fallback_e164: string | null
    call_agent_greeting: string | null
    call_agent_baa_attested: boolean
  }>) {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/org/call-agent', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.message ?? j.error ?? 'Save failed')
      await load()
    } catch (err: any) {
      setError(err?.message ?? 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <Card><CardContent className="p-6 text-sm text-gray-400">Loading…</CardContent></Card>
  }
  if (locked) {
    return (
      <UpgradeCardLocked
        requiredTier="scale"
        capability="Call agent"
        currentTier={(locked as any).current_tier ?? 'starter'}
        bullets={[
          'AI receptionist answers your phone after hours',
          'Books appointments live during the call',
          'Texts patients a /manage link to reschedule or cancel',
          'Every call lands in the contact timeline with transcript + audio',
        ]}
      />
    )
  }
  if (!config) {
    return <Card><CardContent className="p-6 text-sm text-red-600">{error ?? 'Could not load'}</CardContent></Card>
  }

  const baaAttested = config.call_agent_baa_attested_at != null
  const hasNumber   = !!config.twilio_phone_number
  const hasAssistant = !!config.call_agent_assistant_id

  return (
    <>
      {/* ── Pre-flight: Twilio number + Vapi assistant + BAA ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PhoneCall className="h-4 w-4 text-brand-600" />
            Pre-flight checks
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <Check
            ok={hasNumber}
            label="Twilio phone number assigned"
            help="Set in Supabase organizations.twilio_phone_number. Contact ClinIQ support if missing."
          />
          <Check
            ok={hasAssistant}
            label="Vapi assistant configured"
            help="Set call_agent_assistant_id via the setup script after creating the assistant in Vapi."
          />
          <div className="flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-3">
            <input
              id="baa-attest"
              type="checkbox"
              checked={baaAttested}
              disabled={saving}
              onChange={(e) => patch({ call_agent_baa_attested: e.target.checked })}
              className="mt-0.5 h-4 w-4"
            />
            <div className="min-w-0 flex-1">
              <Label htmlFor="baa-attest" className="font-medium text-gray-900">
                BAA on file with Vapi
              </Label>
              <p className="mt-0.5 text-xs text-gray-500">
                You attest that a Business Associate Agreement is signed with Vapi (and Vapi has flowed it down to OpenAI, Deepgram, ElevenLabs). Required by HIPAA — patient PHI in a call's transcript cannot route through the agent without it.
              </p>
              {baaAttested && (
                <p className="mt-1 text-[11px] text-gray-400">
                  Attested {new Date(config.call_agent_baa_attested_at!).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}.
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Main toggle + mode ── */}
      <Card>
        <CardHeader>
          <CardTitle>Routing</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <ToggleRow
            checked={config.call_agent_enabled}
            disabled={!baaAttested || !hasNumber || !hasAssistant || saving}
            onChange={(v) => patch({ call_agent_enabled: v })}
            label="Accept inbound calls with the AI agent"
            help={
              !baaAttested
                ? 'Attest the BAA above first.'
                : !hasNumber || !hasAssistant
                  ? 'Complete pre-flight checks first.'
                  : 'When on, the routing mode below decides which calls reach the agent.'
            }
          />

          <div className="space-y-1.5">
            <Label>Mode</Label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {(['off', 'after_hours', 'always'] as const).map((m) => (
                <ModeButton
                  key={m}
                  active={config.call_agent_mode === m}
                  disabled={!config.call_agent_enabled || saving}
                  onClick={() => patch({ call_agent_mode: m })}
                  label={m === 'off' ? 'Off' : m === 'after_hours' ? 'After hours only' : '24 / 7'}
                  detail={
                    m === 'off'
                      ? 'Always forward to fallback number'
                      : m === 'after_hours'
                        ? 'Agent answers only when closed'
                        : 'Agent answers every call'
                  }
                />
              ))}
            </div>
          </div>

          <FallbackInput
            value={config.call_agent_fallback_e164}
            disabled={saving}
            onCommit={(v) => patch({ call_agent_fallback_e164: v })}
          />

          <GreetingInput
            value={config.call_agent_greeting}
            disabled={saving}
            onCommit={(v) => patch({ call_agent_greeting: v })}
          />

          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
          )}
        </CardContent>
      </Card>
    </>
  )
}

// Text inputs commit on blur (or Enter), not on every keystroke. The
// previous version fired patch() per character + disabled the input
// while the request was in flight — typing more than one digit was
// impossible because the second char hit a disabled input.
function FallbackInput({
  value, disabled, onCommit,
}: { value: string | null; disabled: boolean; onCommit: (v: string | null) => void }) {
  const [draft, setDraft] = useState(value ?? '')
  useEffect(() => { setDraft(value ?? '') }, [value])
  const commit = () => {
    const trimmed = draft.trim()
    const next = trimmed.length === 0 ? null : trimmed
    if (next === (value ?? null)) return
    onCommit(next)
  }
  return (
    <div className="space-y-1.5">
      <Label htmlFor="fallback">Fallback number</Label>
      <Input
        id="fallback"
        type="tel"
        placeholder="+15551234567"
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      />
      <p className="text-xs text-gray-500">
        E.164 format. Where calls bridge when the agent declines (safety triggers) or when mode is &quot;Off&quot; / &quot;After hours&quot; during business hours. Saves when you click away or press Enter.
      </p>
    </div>
  )
}

function GreetingInput({
  value, disabled, onCommit,
}: { value: string | null; disabled: boolean; onCommit: (v: string | null) => void }) {
  const [draft, setDraft] = useState(value ?? '')
  useEffect(() => { setDraft(value ?? '') }, [value])
  const commit = () => {
    const next = draft.length === 0 ? null : draft
    if (next === (value ?? null)) return
    onCommit(next)
  }
  return (
    <div className="space-y-1.5">
      <Label htmlFor="greeting">Custom greeting</Label>
      <Input
        id="greeting"
        placeholder="e.g. Thanks for calling Maria Clinic"
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      />
      <p className="text-xs text-gray-500">
        Leave blank to use the clinic name. The agent&apos;s required AI disclosure + recording-consent lines are appended automatically. Saves when you click away or press Enter.
      </p>
    </div>
  )
}

function Check({ ok, label, help }: { ok: boolean; label: string; help: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-3">
      <div className={`mt-0.5 h-4 w-4 rounded-full ${ok ? 'bg-[#02C39A]' : 'bg-amber-400'}`} />
      <div>
        <p className="font-medium text-gray-900">{label}</p>
        {!ok && (
          <p className="mt-0.5 flex items-start gap-1 text-xs text-amber-800">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
            {help}
          </p>
        )}
      </div>
    </div>
  )
}

function ToggleRow({
  checked, disabled, onChange, label, help,
}: {
  checked: boolean
  disabled: boolean
  onChange: (v: boolean) => void
  label: string
  help: string
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-gray-200 bg-white p-3">
      <div className="min-w-0 flex-1">
        <p className="font-medium text-gray-900">{label}</p>
        <p className="mt-0.5 text-xs text-gray-500">{help}</p>
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        disabled={disabled}
        aria-pressed={checked}
        className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
          checked ? 'bg-[#02C39A]' : 'bg-gray-300'
        }`}
      >
        <span
          className={`inline-block h-5 w-5 mt-0.5 rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-0.5'
          }`}
        />
      </button>
    </div>
  )
}

function ModeButton({
  active, disabled, onClick, label, detail,
}: {
  active: boolean
  disabled: boolean
  onClick: () => void
  label: string
  detail: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg border p-3 text-left text-xs transition disabled:opacity-50 ${
        active
          ? 'border-[#02C39A] bg-[#02C39A]/10 text-[#04B08C]'
          : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
      }`}
    >
      <p className="font-semibold">{label}</p>
      <p className="mt-0.5 text-[11px] opacity-80">{detail}</p>
    </button>
  )
}
