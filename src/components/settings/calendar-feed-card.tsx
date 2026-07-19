'use client'

import { useState } from 'react'
import { CalendarDays, Copy, Check } from 'lucide-react'
import { dict, type Locale } from '@/lib/i18n'

/**
 * Calendar-feed settings card (loop orgs, owner-only). The feed URL is
 * signed server-side (settings page) and passed in — this card is just
 * copy + instructions. `feedUrl` is null when MANAGE_TOKEN_SECRET isn't
 * configured in the environment.
 */
export function CalendarFeedCard({
  locale,
  feedUrl,
}: {
  locale: Locale
  feedUrl: string | null
}) {
  const t = dict(locale).calendar
  const [copied, setCopied] = useState(false)

  async function copy() {
    if (!feedUrl) return
    await navigator.clipboard.writeText(feedUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#02C39A]/15 text-[#028090]">
          <CalendarDays className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-gray-900">{t.title}</h3>
          <p className="mt-0.5 text-sm leading-relaxed text-gray-500">{t.sub}</p>
        </div>
      </div>

      {feedUrl ? (
        <>
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
            <span className="flex-1 truncate font-mono text-xs text-gray-600">{feedUrl}</span>
            <button
              type="button"
              onClick={copy}
              className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border border-[#028090]/30 px-3.5 text-xs font-semibold text-[#028090] transition-colors hover:bg-[#028090]/5"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? t.copied : t.copy}
            </button>
          </div>

          <p className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">{t.howTitle}</p>
          <ul className="mt-1.5 space-y-1.5 text-[13px] leading-relaxed text-gray-600">
            <li>{t.howGoogle}</li>
            <li>{t.howIphone}</li>
          </ul>
          <p className="mt-2.5 text-xs text-gray-400">{t.refreshNote}</p>
        </>
      ) : (
        <p className="mt-3 text-sm text-gray-400">{t.unavailable}</p>
      )}
    </div>
  )
}
