import { Languages, AlertTriangle } from 'lucide-react'

/**
 * Small display badge for a call_logs row's detected language and
 * urgency flag (Multi-vertical Phase 2 + Phase 4 columns:
 * detected_language, is_urgent, urgency_reason — see migrations
 * 20260724_add_call_language / 20260725_add_call_urgency).
 *
 * Both signals were stored but never surfaced in the dashboard; this
 * renders them for the owner. Vertical-neutral: it helps med-spa too
 * (shows the language a caller spoke) and gives trades owners the
 * urgent flag they triage on.
 *
 * Graceful nulls: existing rows predate these columns.
 *   - detected_language NULL  → language pill renders nothing.
 *   - is_urgent NULL/false    → urgent pill renders nothing.
 * So no med-spa regression — an old English-only call shows an empty
 * badge (nothing), never a wrong label.
 *
 * Server-renderable (no client state, no handlers). Reduced-motion
 * safe: no animation. Brand tokens teal #028090 / mint #02C39A /
 * amber #B5710F.
 */

interface Props {
  detectedLanguage: string | null
  isUrgent:         boolean | null
  urgencyReason:    string | null
  /** 'short' → 'EN'/'ES'; 'long' → 'English'/'Español'. Default 'long'. */
  variant?:         'short' | 'long'
  className?:       string
}

const LANG_SHORT: Record<string, string> = { en: 'EN', es: 'ES' }
const LANG_LONG:  Record<string, string> = { en: 'English', es: 'Español' }

export function CallLanguageBadge({
  detectedLanguage, isUrgent, urgencyReason, variant = 'long', className,
}: Props) {
  const langKey = detectedLanguage === 'en' || detectedLanguage === 'es'
    ? detectedLanguage
    : null
  const langLabel = langKey
    ? (variant === 'short' ? LANG_SHORT : LANG_LONG)[langKey]
    : null

  // Nothing to show → render nothing (keeps old rows clean).
  if (!langLabel && !isUrgent) return null

  return (
    <span className={`inline-flex items-center gap-1.5${className ? ` ${className}` : ''}`}>
      {langLabel && (
        <span
          className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium"
          style={{ borderColor: '#028090', color: '#028090', backgroundColor: '#02809012' }}
        >
          <Languages className="h-3 w-3" />
          {langLabel}
        </span>
      )}
      {isUrgent && (
        <span
          className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold"
          style={{ borderColor: '#B5710F', color: '#B5710F', backgroundColor: '#02C39A14' }}
          title={urgencyReason || 'Marked urgent by the agent'}
        >
          <AlertTriangle className="h-3 w-3" />
          Urgent
        </span>
      )}
    </span>
  )
}
