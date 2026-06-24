'use client'
import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type AiTwinSettings = {
  ai_twin_enabled: boolean
  ai_twin_quiet_hours_start: string | null
  ai_twin_quiet_hours_end:   string | null
}

/**
 * Normalize a Postgres-style "HH:MM:SS" (or "HH:MM") to the "HH:MM"
 * form that <input type="time"> wants. Returns '' for null so the
 * input renders empty.
 */
function toInputTime(v: string | null): string {
  if (!v) return ''
  const m = v.match(/^(\d{2}:\d{2})/)
  return m ? m[1] : ''
}

export function AiTwinSettingsCard({ initial }: { initial: AiTwinSettings }) {
  const [settings, setSettings] = useState<AiTwinSettings>({
    ai_twin_enabled: initial.ai_twin_enabled,
    ai_twin_quiet_hours_start: initial.ai_twin_quiet_hours_start,
    ai_twin_quiet_hours_end:   initial.ai_twin_quiet_hours_end,
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  function toggleEnabled() {
    setSettings(s => ({ ...s, ai_twin_enabled: !s.ai_twin_enabled }))
    setSaved(false)
  }

  function setQuietStart(v: string) {
    setSettings(s => ({ ...s, ai_twin_quiet_hours_start: v || null }))
    setSaved(false)
  }

  function setQuietEnd(v: string) {
    setSettings(s => ({ ...s, ai_twin_quiet_hours_end: v || null }))
    setSaved(false)
  }

  async function save() {
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      const res = await fetch('/api/org/ai-twin-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ai_twin_enabled: settings.ai_twin_enabled,
          ai_twin_quiet_hours_start: settings.ai_twin_quiet_hours_start,
          ai_twin_quiet_hours_end:   settings.ai_twin_quiet_hours_end,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'Failed to save')
      }
      const j = await res.json().catch(() => ({}))
      if (j.settings) setSettings(j.settings)
      setSaved(true)
    } catch (err: any) {
      setError(err.message ?? 'Network error.')
    } finally {
      setSaving(false)
    }
  }

  const startValue = toInputTime(settings.ai_twin_quiet_hours_start)
  const endValue   = toInputTime(settings.ai_twin_quiet_hours_end)

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI Twin</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5 text-sm">

        {/* Master toggle */}
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium text-gray-900">Enable AI Twin drafts</div>
            <div className="text-xs text-gray-400 mt-0.5">
              When a patient texts in, we draft a reply for you to review before sending.
            </div>
          </div>
          <button
            type="button"
            onClick={toggleEnabled}
            className={[
              'relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2',
              settings.ai_twin_enabled ? 'bg-brand-600' : 'bg-gray-200',
            ].join(' ')}
            aria-pressed={settings.ai_twin_enabled}
            aria-label="Enable AI Twin drafts"
          >
            <span
              className={[
                'inline-block h-4 w-4 rounded-full bg-white shadow transition-transform',
                settings.ai_twin_enabled ? 'translate-x-6' : 'translate-x-1',
              ].join(' ')}
            />
          </button>
        </div>

        {/* Quiet hours block — disabled when AI Twin is off */}
        <div className={['border-t border-gray-100 pt-5 space-y-3', settings.ai_twin_enabled ? '' : 'opacity-50 pointer-events-none'].join(' ')}>
          <div>
            <p className="font-medium text-gray-900">Quiet hours (optional)</p>
            <p className="text-xs text-gray-400 mt-0.5">
              During this window, drafts are generated and held until the window ends so patients don't see AI activity overnight.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="ai-twin-start" className="block text-xs font-medium text-gray-600 mb-1.5">Start</label>
              <input
                id="ai-twin-start"
                type="time"
                value={startValue}
                onChange={(e) => setQuietStart(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
              />
            </div>
            <div>
              <label htmlFor="ai-twin-end" className="block text-xs font-medium text-gray-600 mb-1.5">End</label>
              <input
                id="ai-twin-end"
                type="time"
                value={endValue}
                onChange={(e) => setQuietEnd(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
              />
            </div>
          </div>
          <p className="text-xs text-gray-400">
            Set both fields or leave both blank. Times are in your clinic timezone.
          </p>
        </div>

        {error && (
          <p className="text-sm text-red-600">{error}</p>
        )}

        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="w-full rounded-lg bg-brand-600 hover:bg-brand-700 disabled:bg-brand-400 text-white font-semibold text-sm py-2.5 transition-colors"
        >
          {saving ? 'Saving...' : saved ? 'Saved' : 'Save AI Twin settings'}
        </button>
      </CardContent>
    </Card>
  )
}
