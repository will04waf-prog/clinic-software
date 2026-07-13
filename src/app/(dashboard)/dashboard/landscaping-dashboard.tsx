'use client'
import Link from 'next/link'
import { Sun, CalendarDays, FileText, Receipt } from 'lucide-react'
import { dict, type Locale } from '@/lib/i18n'
import { LandscapingEmptyState } from '@/components/dashboard/landscaping-empty-state'

/**
 * Landscaping (loop) home — the Spanish empty-state plus quick links into
 * the loop's core surfaces. No Layla setup guide, phone banner, or
 * morning briefing.
 */
export function LandscapingDashboard({ locale, ownerName }: { locale: Locale; ownerName: string | null }) {
  const d = dict(locale).dashboard
  const job = dict(locale).job

  const quickLinks = [
    { href: '/schedule', label: job.scheduleTitle, icon: CalendarDays },
    { href: '/estimates', label: d.estimates, icon: FileText },
    { href: '/invoices', label: d.invoices, icon: Receipt },
  ]

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-16 shrink-0 items-center gap-3 border-b border-[#02C39A]/35 bg-[#F5EFE1] px-4 sm:px-6">
        <span className="inline-flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[10px] bg-[#02C39A]/15">
          <Sun className="h-5 w-5 text-[#028090]" fill="currentColor" />
        </span>
        <h1
          className="text-[#0B2027]"
          style={{ fontFamily: 'var(--font-newsreader), Newsreader, Georgia, serif', fontSize: '22px', fontWeight: 600 }}
        >
          Tarhunna
        </h1>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 sm:py-8">
        <div className="mx-auto flex max-w-[720px] flex-col gap-6">
          <LandscapingEmptyState locale={locale} ownerName={ownerName} />

          <div className="grid grid-cols-2 gap-3">
            {quickLinks.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-4 shadow-sm transition-colors hover:border-[#02C39A]/50 hover:bg-[#02C39A]/5"
              >
                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#02C39A]/12 text-[#028090]">
                  <Icon className="h-5 w-5" />
                </span>
                <span className="text-[15px] font-semibold text-[#0B2027]">{label}</span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
