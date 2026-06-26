'use client'
import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type TestBanner = { kind: 'success' | 'warning' | 'error'; text: string }

const PLACEHOLDER_CONFIRMATION =
  'Hi {{first_name}}, your consultation with {{clinic_name}} is confirmed for {{date}} at {{time}}. Reply STOP to opt out.'
const PLACEHOLDER_24H =
  'Hi {{first_name}}, reminder: your consultation with {{clinic_name}} is tomorrow at {{time}}. Reply STOP to opt out.'
const PLACEHOLDER_2H =
  'Hi {{first_name}}, your consultation with {{clinic_name}} is in about 2 hours at {{time}}. See you soon! Reply STOP to opt out.'

type SmsSettings = {
  sms_enabled:               boolean
  sms_confirmation_enabled:  boolean
  sms_reminder_24h_enabled:  boolean
  sms_reminder_2h_enabled:   boolean
  sms_template_confirmation: string | null
  sms_template_reminder_24h: string | null
  sms_template_reminder_2h:  string | null
}

export function SmsSettingsCard({ initial }: { initial: SmsSettings }) {
  const [settings, setSettings] = useState<SmsSettings>(initial)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const [testPhone, setTestPhone]   = useState('')
  const [testing, setTesting]       = useState(false)
  const [testBanner, setTestBanner] = useState<TestBanner | null>(null)

  useEffect(() => {
    if (!testBanner) return
    const t = setTimeout(() => setTestBanner(null), 10000)
    return () => clearTimeout(t)
  }, [testBanner])

  async function sendTest() {
    setTesting(true)
    setTestBanner(null)
    try {
      const res = await fetch('/api/org/test-sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: testPhone.trim() }),
      })
      const j = await res.json().catch(() => ({} as Record<string, string>))
      if (res.ok) {
        setTestBanner({ kind: 'success', text: `Test SMS sent to ${j.sent_to}` })
      } else if (res.status === 429 || res.status === 503) {
        setTestBanner({ kind: 'warning', text: j.message ?? 'Request blocked.' })
      } else {
        setTestBanner({ kind: 'error', text: j.message ?? 'Failed to send test SMS.' })
      }
    } catch (err: any) {
      setTestBanner({ kind: 'error', text: err?.message ?? 'Network error.' })
    } finally {
      setTesting(false)
    }
  }

  function toggle(key: keyof SmsSettings) {
    setSettings((s) => ({ ...s, [key]: !s[key] }))
    setSaved(false)
  }

  function setTemplate(key: keyof SmsSettings, value: string) {
    setSettings((s) => ({ ...s, [key]: value }))
    setSaved(false)
  }

  async function save() {
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      const res = await fetch('/api/org/sms-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.message ?? j.error ?? 'Failed to save')
      }
      setSaved(true)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const vars = (
    <span className="font-mono text-brand-600">
      {'{{first_name}} {{clinic_name}} {{date}} {{time}}'}
    </span>
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>SMS Reminders</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5 text-sm">

        {/* Master toggle */}
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium text-gray-900">Enable SMS reminders</div>
            <div className="text-xs text-gray-400 mt-0.5">Master switch — turns off all SMS for this clinic</div>
          </div>
          <button
            type="button"
            onClick={() => toggle('sms_enabled')}
            className={[
              'relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2',
              settings.sms_enabled ? 'bg-brand-600' : 'bg-gray-200',
            ].join(' ')}
          >
            <span
              className={[
                'inline-block h-4 w-4 rounded-full bg-white shadow transition-transform',
                settings.sms_enabled ? 'translate-x-6' : 'translate-x-1',
              ].join(' ')}
            />
          </button>
        </div>

        {settings.sms_enabled && (
          <div className="space-y-5 border-t border-gray-100 pt-5">

            {/* Per-type toggles */}
            {(
              [
                { key: 'sms_confirmation_enabled',  label: 'Confirmation SMS',   desc: 'Sent immediately when a consultation is booked' },
                { key: 'sms_reminder_24h_enabled',  label: '24-hour reminder',    desc: 'Sent 24 hours before the consultation' },
                { key: 'sms_reminder_2h_enabled',   label: '2-hour reminder',     desc: 'Sent 2 hours before the consultation' },
              ] as { key: keyof SmsSettings; label: string; desc: string }[]
            ).map(({ key, label, desc }) => (
              <div key={key} className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-gray-900">{label}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{desc}</div>
                </div>
                <button
                  type="button"
                  onClick={() => toggle(key)}
                  className={[
                    'relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2',
                    settings[key] ? 'bg-brand-600' : 'bg-gray-200',
                  ].join(' ')}
                >
                  <span
                    className={[
                      'inline-block h-4 w-4 rounded-full bg-white shadow transition-transform',
                      settings[key] ? 'translate-x-6' : 'translate-x-1',
                    ].join(' ')}
                  />
                </button>
              </div>
            ))}

            {/* Templates */}
            <div className="border-t border-gray-100 pt-5 space-y-4">
              <div>
                <p className="font-medium text-gray-900 mb-1">Message templates</p>
                <p className="text-xs text-gray-400">
                  Leave blank to use the default. Available variables: {vars}
                </p>
              </div>

              {(
                [
                  { key: 'sms_template_confirmation',  label: 'Confirmation',   placeholder: PLACEHOLDER_CONFIRMATION },
                  { key: 'sms_template_reminder_24h',  label: '24-hour',        placeholder: PLACEHOLDER_24H },
                  { key: 'sms_template_reminder_2h',   label: '2-hour',         placeholder: PLACEHOLDER_2H },
                ] as { key: keyof SmsSettings; label: string; placeholder: string }[]
              ).map(({ key, label, placeholder }) => (
                <div key={key}>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">{label}</label>
                  <textarea
                    rows={3}
                    value={(settings[key] as string) ?? ''}
                    onChange={(e) => setTemplate(key, e.target.value)}
                    placeholder={placeholder}
                    maxLength={320}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 resize-none"
                  />
                  <p className="text-right text-xs text-gray-300 mt-0.5">
                    {((settings[key] as string) ?? '').length}/320
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Note about consent */}
        <p className="text-xs text-gray-400 border-t border-gray-100 pt-4">
          SMS is only sent to patients who provided consent during intake and have not opted out. Patients who enter their phone number on your capture form will see an SMS consent checkbox.
        </p>

        {error && (
          <p className="text-sm text-red-600">{error}</p>
        )}

        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="w-full rounded-lg bg-brand-600 hover:bg-brand-700 disabled:bg-brand-400 text-white font-semibold text-sm py-2.5 transition-colors"
        >
          {saving ? 'Saving...' : saved ? 'Saved' : 'Save SMS settings'}
        </button>

        {/* Test SMS section */}
        <div className="border-t border-gray-100 pt-5 space-y-4">
          <div>
            <p className="font-medium text-gray-900 mb-1">Test your setup</p>
            <p className="text-xs text-gray-400">Send a test SMS to verify everything is configured correctly.</p>
          </div>

          <div>
            <label htmlFor="test-sms-phone" className="block text-xs font-medium text-gray-600 mb-1.5">Phone number</label>
            <input
              id="test-sms-phone"
              type="tel"
              value={testPhone}
              onChange={(e) => setTestPhone(e.target.value)}
              placeholder="+1 (555) 555-5555"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
            />
            <p className="text-xs text-gray-400 mt-1">Enter the phone number where you want to receive the test message.</p>
          </div>

          <button
            type="button"
            onClick={sendTest}
            disabled={testing || !testPhone.trim()}
            className="w-full rounded-lg bg-brand-600 hover:bg-brand-700 disabled:bg-brand-400 disabled:cursor-not-allowed text-white font-semibold text-sm py-2.5 transition-colors"
          >
            {testing ? 'Sending...' : 'Send test SMS'}
          </button>

          {testBanner && (
            <div
              className={[
                'flex items-start justify-between gap-3 rounded-lg border px-3 py-2 text-sm',
                testBanner.kind === 'success' && 'bg-emerald-50 border-emerald-200 text-emerald-700',
                testBanner.kind === 'warning' && 'bg-amber-50 border-amber-200 text-amber-700',
                testBanner.kind === 'error'   && 'bg-red-50   border-red-200   text-red-700',
              ].filter(Boolean).join(' ')}
            >
              <span>{testBanner.text}</span>
              <button
                type="button"
                onClick={() => setTestBanner(null)}
                className="text-current opacity-50 hover:opacity-100 leading-none text-lg"
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
