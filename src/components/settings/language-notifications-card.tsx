'use client'

/**
 * Multi-vertical Phase 6 — owner-facing "Language & notifications"
 * card on /settings (owner-only at the page layer; the API also
 * enforces OWNER_ONLY).
 *
 * Four settings, one Save:
 *   1. Caller languages — which languages Layla handles on the phone
 *      line (EN / ES / both). Changing this live-PATCHes the Vapi
 *      assistant (voice + transcriber + bilingual prompt); the API
 *      response's assistant_synced=false surfaces as a warning banner.
 *   2. Owner language — EN/ES for owner-facing summaries + alerts only.
 *   3. Notification channel — SMS / WhatsApp / Both for owner alerts.
 *   4. Owner mobile — E.164; blank = email-only alerts.
 *
 * Server-prefetched initial (no loading flash) like SmsSettingsCard;
 * batched explicit Save (not per-field patch) because a caller-language
 * flip triggers a Vapi round-trip we don't want fired per click.
 */

import { useState } from 'react'
import { Languages } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export type CallerLanguage = 'en' | 'es'

export interface LanguageNotificationsInitial {
  caller_languages:     CallerLanguage[]
  owner_language:       'en' | 'es'
  notification_channel: 'sms' | 'whatsapp' | 'both'
  owner_notify_e164:    string | null
}

// Mirrors the API's zod E164_RE — validate before the request so the
// owner gets an inline hint instead of a 400 round-trip.
const E164_RE = /^\+[1-9]\d{6,14}$/

export function LanguageNotificationsCard({ initial }: { initial: LanguageNotificationsInitial }) {
  const [callerLangs, setCallerLangs] = useState<CallerLanguage[]>(
    initial.caller_languages.length > 0 ? initial.caller_languages : ['en'],
  )
  const [ownerLang, setOwnerLang]   = useState<'en' | 'es'>(initial.owner_language)
  const [channel, setChannel]       = useState<'sms' | 'whatsapp' | 'both'>(initial.notification_channel)
  const [mobile, setMobile]         = useState(initial.owner_notify_e164 ?? '')
  const [saving, setSaving]         = useState(false)
  const [saved, setSaved]           = useState(false)
  const [error, setError]           = useState('')
  const [syncWarning, setSyncWarning] = useState(false)

  const mobileTrimmed = mobile.trim()
  const mobileInvalid = mobileTrimmed.length > 0 && !E164_RE.test(mobileTrimmed)

  function toggleCallerLang(lang: CallerLanguage) {
    setSaved(false)
    setCallerLangs((prev) => {
      if (prev.includes(lang)) {
        // Never allow an empty set — the line has to speak SOMETHING.
        if (prev.length === 1) return prev
        return prev.filter((l) => l !== lang)
      }
      // Keep a stable canonical order (en first) so saves are
      // idempotent regardless of click order.
      const next = [...prev, lang]
      return (['en', 'es'] as const).filter((l) => next.includes(l))
    })
  }

  async function save() {
    setSaving(true)
    setError('')
    setSaved(false)
    setSyncWarning(false)
    try {
      if (mobileInvalid) {
        throw new Error('Owner mobile must be in E.164 format, e.g. +13015551234.')
      }
      const res = await fetch('/api/org/language-notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caller_languages:     callerLangs,
          owner_language:       ownerLang,
          notification_channel: channel,
          owner_notify_e164:    mobileTrimmed.length > 0 ? mobileTrimmed : null,
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.message ?? j.error ?? 'Failed to save')
      setSaved(true)
      // assistant_synced === false means the settings SAVED but the
      // live phone assistant couldn't be updated (Vapi down / config).
      // null means no live assistant yet — nothing to warn about.
      if (j.assistant_synced === false) setSyncWarning(true)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Languages className="h-4 w-4 text-brand-600" />
          Language &amp; notifications
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5 text-sm">

        {/* ── 1. Caller languages ── */}
        <div className="space-y-1.5">
          <p className="font-medium text-gray-900">Languages your AI receptionist speaks</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <LangButton
              active={callerLangs.includes('en')}
              disabled={saving || (callerLangs.length === 1 && callerLangs[0] === 'en')}
              onClick={() => toggleCallerLang('en')}
              label="English"
              detail="Callers are served in English"
            />
            <LangButton
              active={callerLangs.includes('es')}
              disabled={saving || (callerLangs.length === 1 && callerLangs[0] === 'es')}
              onClick={() => toggleCallerLang('es')}
              label="Español"
              detail="Callers are served in Spanish"
            />
          </div>
          <p className="text-xs text-gray-500">
            {callerLangs.includes('es')
              ? 'With Spanish on, the receptionist follows each caller’s language automatically — including mid-call switches — and uses a voice that sounds natural in both languages.'
              : 'Turn on Español to serve Spanish-speaking callers. The receptionist will follow whichever language the caller uses.'}
            {' '}At least one language stays on.
          </p>
        </div>

        {/* ── 2. Owner language ── */}
        <div className="space-y-1.5 border-t border-gray-100 pt-5">
          <p className="font-medium text-gray-900">Your language</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <LangButton
              active={ownerLang === 'en'}
              disabled={saving}
              onClick={() => { setOwnerLang('en'); setSaved(false) }}
              label="English"
              detail="Summaries and alerts in English"
            />
            <LangButton
              active={ownerLang === 'es'}
              disabled={saving}
              onClick={() => { setOwnerLang('es'); setSaved(false) }}
              label="Español"
              detail="Resúmenes y alertas en español"
            />
          </div>
          <p className="text-xs text-gray-500">
            Only affects what YOU read — call summaries and alert messages. It does not change what callers hear.
          </p>
        </div>

        {/* ── 3. Notification channel ── */}
        <div className="space-y-1.5 border-t border-gray-100 pt-5">
          <p className="font-medium text-gray-900">Where to send you alerts</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {([
              { value: 'sms',      label: 'SMS',      detail: 'Text message to your mobile' },
              { value: 'whatsapp', label: 'WhatsApp', detail: 'WhatsApp message; falls back to SMS if undeliverable' },
              { value: 'both',     label: 'Both',     detail: 'SMS and WhatsApp' },
            ] as const).map((opt) => (
              <LangButton
                key={opt.value}
                active={channel === opt.value}
                disabled={saving}
                onClick={() => { setChannel(opt.value); setSaved(false) }}
                label={opt.label}
                detail={opt.detail}
              />
            ))}
          </div>
          <p className="text-xs text-gray-500">
            Urgent-call and new-lead alerts. Email alerts always stay on regardless of this setting.
          </p>
        </div>

        {/* ── 4. Owner mobile ── */}
        <div className="space-y-1.5 border-t border-gray-100 pt-5">
          <label htmlFor="owner-notify-mobile" className="font-medium text-gray-900 block">
            Your mobile number
          </label>
          <input
            id="owner-notify-mobile"
            type="tel"
            value={mobile}
            disabled={saving}
            onChange={(e) => { setMobile(e.target.value); setSaved(false) }}
            placeholder="+13015551234"
            className={[
              'w-full rounded-lg border px-3 py-2 text-sm text-gray-900 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 disabled:opacity-50',
              mobileInvalid ? 'border-red-300' : 'border-gray-300',
            ].join(' ')}
          />
          <p className={`text-xs ${mobileInvalid ? 'text-red-600' : 'text-gray-500'}`}>
            {mobileInvalid
              ? 'Must be E.164 format — country code first, e.g. +13015551234.'
              : 'E.164 format (+1…). Leave blank to receive alerts by email only.'}
          </p>
        </div>

        {syncWarning && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Settings saved, but the live phone assistant could not be updated right now. Your language change will apply once the connection to the voice provider recovers — or contact support if this persists.
          </div>
        )}
        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
        )}

        <button
          type="button"
          onClick={save}
          disabled={saving || mobileInvalid}
          className="w-full rounded-lg bg-brand-600 hover:bg-brand-700 disabled:bg-brand-400 disabled:cursor-not-allowed text-white font-semibold text-sm py-2.5 transition-colors"
        >
          {saving ? 'Saving...' : saved ? 'Saved' : 'Save language & notification settings'}
        </button>
      </CardContent>
    </Card>
  )
}

// Same visual grammar as the call-agent ModeButton — selected state is
// the brand-green outline chip.
function LangButton({
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
      aria-pressed={active}
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
