'use client'

/**
 * CRM-pivot LOOP — landscaping dashboard empty-state ("Empecemos").
 *
 * The Phase-1 carryover: a friendly Spanish-first card that greets the
 * owner and points at the two moves that start the loop — add a client
 * and write an estimate — plus a compact 4-step reminder of the whole
 * loop (client → estimate → send → get paid). Mobile-first.
 *
 * Copy comes from dict.dashboard.* + dict.estimate.*. The greeting word
 * ("Hola") is a local literal — no dedicated i18n key exists yet.
 */

import Link from 'next/link'
import { UserPlus, FileText, Send, Wallet, ArrowRight } from 'lucide-react'
import { dict, type Locale } from '@/lib/i18n'

export function LandscapingEmptyState({
  locale,
  ownerName,
}: {
  locale: Locale
  ownerName?: string | null
}) {
  const d = dict(locale).dashboard
  const e = dict(locale).estimate

  const steps = [
    { icon: UserPlus, label: d.addClient },
    { icon: FileText, label: d.newEstimate },
    { icon: Send, label: e.send },
    { icon: Wallet, label: d.getPaid },
  ]

  const greeting = locale === 'es' ? 'Hola' : 'Hi'

  return (
    <div className="rounded-2xl border border-[#02C39A]/35 bg-white p-6 shadow-sm sm:p-8">
      {ownerName && (
        <p className="mb-1 text-[13px] font-semibold uppercase tracking-wide text-[#028090]">
          {greeting}, {ownerName}
        </p>
      )}
      <h2
        className="text-[#0B2027]"
        style={{
          fontFamily: 'var(--font-newsreader), Newsreader, Georgia, serif',
          fontSize: '28px',
          fontWeight: 600,
          lineHeight: 1.1,
        }}
      >
        {d.emptyTitle}
      </h2>
      <p className="mt-2 max-w-md text-[15px] text-[#5A6A70]">{d.emptySubtitle}</p>

      {/* Two primary CTAs */}
      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <Link
          href="/clients"
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#028090] px-5 py-3 text-[15px] font-semibold text-white shadow-[0_2px_8px_-2px_rgba(2,128,144,0.5)] transition-colors hover:bg-[#026B78]"
        >
          <UserPlus className="h-4.5 w-4.5" strokeWidth={2.4} />
          {d.addClient}
        </Link>
        <Link
          href="/estimates/new"
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#028090]/30 bg-[#02C39A]/5 px-5 py-3 text-[15px] font-semibold text-[#028090] transition-colors hover:bg-[#02C39A]/10"
        >
          <FileText className="h-4.5 w-4.5" strokeWidth={2.4} />
          {d.newEstimate}
        </Link>
      </div>

      {/* 4-step loop reminder */}
      <div className="mt-8 border-t border-gray-100 pt-6">
        <ol className="flex flex-col gap-3 sm:flex-row sm:items-stretch sm:gap-2">
          {steps.map((step, i) => {
            const Icon = step.icon
            return (
              <li key={i} className="flex flex-1 items-center gap-3 sm:flex-col sm:items-start sm:gap-2">
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#02C39A]/12 text-[#028090]">
                  <Icon className="h-4.5 w-4.5" />
                </span>
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-bold text-[#A4AFB2]">{i + 1}</span>
                  <span className="text-[13.5px] font-medium text-[#0B2027]">{step.label}</span>
                </div>
                {i < steps.length - 1 && (
                  <ArrowRight className="hidden h-4 w-4 text-[#D4CFC2] sm:ml-auto sm:block" />
                )}
              </li>
            )
          })}
        </ol>
      </div>
    </div>
  )
}
