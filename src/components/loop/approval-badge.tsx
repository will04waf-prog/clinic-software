import { ShieldCheck } from 'lucide-react'
import { dict, type Locale } from '@/lib/i18n'

/**
 * The client-approval "shield" — makes the invisible approval record
 * (timestamp + IP, stamped when the client tapped Aprobar) VISIBLE proof
 * that the scope was agreed. Rendered on the estimate, invoice, and the
 * PUBLIC pages a client/bank sees — the exact artifact the $1,306
 * dry-well dispute lacked. Presentational + server-safe (no hooks).
 *
 * `variant`: 'solid' for owner surfaces (green pill), 'muted' for the
 * public/client pages (quieter, still unmistakably a stamp).
 */
export function ApprovalBadge({
  approvedAt,
  clientName,
  locale,
  variant = 'solid',
  className = '',
}: {
  approvedAt: string | null | undefined
  clientName?: string | null
  locale: Locale
  variant?: 'solid' | 'muted'
  className?: string
}) {
  if (!approvedAt) return null
  const d = new Date(approvedAt)
  if (isNaN(d.getTime())) return null

  const intlLocale = locale === 'es' ? 'es-US' : 'en-US'
  const date = new Intl.DateTimeFormat(intlLocale, { day: 'numeric', month: 'long', year: 'numeric' }).format(d)
  const time = new Intl.DateTimeFormat(intlLocale, { hour: 'numeric', minute: '2-digit' }).format(d)

  const t = dict(locale).proof
  const name = clientName?.trim()
  const text = name ? t.approvedByName(name, date, time) : t.approvedOn(date, time)

  const cls =
    variant === 'solid'
      ? 'bg-[#02C39A]/12 text-[#0B7A5E] border border-[#02C39A]/25'
      : 'bg-[#0B7A5E]/8 text-[#0B7A5E] border border-[#0B7A5E]/15'

  return (
    <div
      className={`inline-flex items-start gap-2 rounded-xl px-3 py-2 text-sm font-medium ${cls} ${className}`}
      role="note"
    >
      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{text}</span>
    </div>
  )
}
