'use client'

import { useState } from 'react'
import { Star, ExternalLink } from 'lucide-react'
import { dict, type Locale } from '@/lib/i18n'

/**
 * Google-reviews settings card (loop orgs, owner-only). Saving a Place
 * ID is the review-request feature's on-switch; clearing it turns the
 * flow off. The link preview lets the owner sanity-check that taps land
 * on THEIR business before any customer sees it.
 */
export function GoogleReviewsCard({
  locale,
  initialPlaceId,
}: {
  locale: Locale
  initialPlaceId: string | null
}) {
  const t = dict(locale).reviews
  const [input, setInput] = useState(initialPlaceId ?? '')
  const [placeId, setPlaceId] = useState(initialPlaceId)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  const link = placeId
    ? `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`
    : null

  async function save() {
    setSaving(true)
    setNotice('')
    setError('')
    try {
      const res = await fetch('/api/org/review-link', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error === 'unparseable' ? t.errUnparseable : t.errGeneric)
        return
      }
      setPlaceId(body.placeId ?? null)
      setInput(body.placeId ?? '')
      setNotice(body.placeId ? t.saved : t.cleared)
    } catch {
      setError(t.errGeneric)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#02C39A]/15 text-[#028090]">
          <Star className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-gray-900">{t.title}</h3>
          <p className="mt-0.5 text-sm leading-relaxed text-gray-500">{t.sub}</p>
        </div>
      </div>

      <p className={`mt-3 text-xs font-medium ${placeId ? 'text-[#0B7A5E]' : 'text-gray-400'}`}>
        {placeId ? t.active : t.inactive}
      </p>

      <label className="mt-3 block text-xs font-medium text-gray-600">{t.inputLabel}</label>
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={t.inputPlaceholder}
        className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2.5 font-mono text-xs text-gray-800 placeholder:text-gray-300 focus:border-[#028090] focus:outline-none"
      />
      <p className="mt-1.5 text-xs text-gray-400">{t.help}</p>

      {notice && <p className="mt-2 text-xs text-[#0B7A5E]">{notice}</p>}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[#028090] px-5 text-sm font-semibold text-white transition hover:bg-[#026B78] disabled:opacity-60"
        >
          {saving ? t.saving : t.save}
        </button>
        {link && (
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-[#028090] underline decoration-[#028090]/30 underline-offset-2"
          >
            <ExternalLink className="h-3.5 w-3.5" /> {t.testLink}
          </a>
        )}
      </div>
    </div>
  )
}
