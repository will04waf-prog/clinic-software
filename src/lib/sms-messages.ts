import { renderTemplate } from '@/lib/twilio'
import { getVerticalConfig } from '@/lib/vertical/config'

export type SmsMessageType = 'confirmation' | 'reminder_24h' | 'reminder_2h'

/**
 * Customer-facing SMS language. Chosen from the CONTACT's
 * preferred_language (stamped by the voice pipeline), never the owner's:
 * the person receiving the text reads it in their own language. Med-spa
 * stays English-only regardless — see buildDefaultTemplate.
 */
export type SmsLang = 'en' | 'es'

// Med-spa English defaults — the byte-identical baseline. Kept as
// literals (not derived from terms) so the med-spa surface is provably
// unchanged; buildDefaultTemplate returns THESE verbatim for medspa.
const DEFAULT_TEMPLATES: Record<SmsMessageType, string> = {
  // {{manage_url}} renders as the raw URL (no prefix) when provided —
  // keeps the confirmation message under the 160-char single-segment
  // SMS budget for typical clinic names and URLs. For manual bookings
  // and reminder paths that don't sign a token, the placeholder
  // collapses to "", which leaves only the period and a single
  // separating space (handled by collapsing in the renderer).
  confirmation:
    'Hi {{first_name}}, your consultation with {{clinic_name}} is confirmed for {{date}} at {{time}}. {{manage_url}}Reply STOP to opt out.',
  // Reminder templates intentionally omit {{manage_url}} — the
  // reminder cron doesn't sign tokens, and stuffing an empty
  // placeholder there created a permanently-empty string risk.
  // Reschedule lives on the confirmation SMS only.
  reminder_24h:
    'Hi {{first_name}}, reminder: your consultation with {{clinic_name}} is tomorrow at {{time}}. Reply STOP to opt out.',
  reminder_2h:
    'Hi {{first_name}}, your consultation with {{clinic_name}} is in about 2 hours at {{time}}. See you soon! Reply STOP to opt out.',
}

/**
 * Per-vertical default template. Med-spa returns the frozen English
 * literals above (byte-for-byte unchanged, English-only as it's always
 * been). Every other vertical swaps the scheduled-thing noun for its own
 * term — terms.engagement in English, terms.engagementEs when the
 * contact's preferred_language is 'es'. {{business_name}} is the neutral
 * org-name placeholder; {{clinic_name}} stays a supported alias (see the
 * render map) so custom med-spa templates keep rendering.
 */
function buildDefaultTemplate(
  type: SmsMessageType,
  vertical: string | null | undefined,
  lang: SmsLang,
): string {
  const cfg = getVerticalConfig(vertical)
  if (cfg.vertical === 'medspa') return DEFAULT_TEMPLATES[type]

  const noun = lang === 'es' ? cfg.terms.engagementEs : cfg.terms.engagement
  if (lang === 'es') {
    const es: Record<SmsMessageType, string> = {
      confirmation:
        `Hola {{first_name}}, le confirmamos su ${noun} con {{business_name}} para {{date}} a las {{time}}. {{manage_url}}Responda STOP para cancelar.`,
      reminder_24h:
        `Hola {{first_name}}, recordatorio: su ${noun} con {{business_name}} es mañana a las {{time}}. Responda STOP para cancelar.`,
      reminder_2h:
        `Hola {{first_name}}, su ${noun} con {{business_name}} es en unas 2 horas a las {{time}}. ¡Nos vemos pronto! Responda STOP para cancelar.`,
    }
    return es[type]
  }
  const en: Record<SmsMessageType, string> = {
    confirmation:
      `Hi {{first_name}}, your ${noun} with {{business_name}} is confirmed for {{date}} at {{time}}. {{manage_url}}Reply STOP to opt out.`,
    reminder_24h:
      `Hi {{first_name}}, reminder: your ${noun} with {{business_name}} is tomorrow at {{time}}. Reply STOP to opt out.`,
    reminder_2h:
      `Hi {{first_name}}, your ${noun} with {{business_name}} is in about 2 hours at {{time}}. See you soon! Reply STOP to opt out.`,
  }
  return en[type]
}

/**
 * Per-vertical default SMS copy, exported for the settings preview so an
 * owner sees the wording their customers will actually receive. Med-spa
 * yields today's English 'consultation' copy unchanged. (The client
 * settings card can't import this module directly — it pulls in the
 * Twilio SDK — so the card mirrors these literals via getVerticalConfig;
 * server callers should use this helper.)
 */
export function defaultSmsTemplate(
  type: SmsMessageType,
  vertical: string | null | undefined,
  lang: SmsLang = 'en',
): string {
  return buildDefaultTemplate(type, vertical, lang)
}

export function getTemplate(
  type: SmsMessageType,
  org: {
    vertical?: string | null
    sms_template_confirmation?: string | null
    /** Owner-authored Spanish confirmation template. Used only for an
     *  es-preferring caller; NULL falls back to the English template,
     *  so a med-spa org (which never sets this) is byte-identical. */
    sms_template_confirmation_es?: string | null
    sms_template_reminder_24h?: string | null
    sms_template_reminder_2h?: string | null
  },
  lang: SmsLang = 'en',
): string {
  const custom =
    type === 'confirmation'
      // Prefer the Spanish confirmation template for an es caller when the
      // owner authored one; otherwise the English confirmation template.
      ? (lang === 'es' ? (org.sms_template_confirmation_es ?? org.sms_template_confirmation) : org.sms_template_confirmation)
      : type === 'reminder_24h' ? org.sms_template_reminder_24h
                                : org.sms_template_reminder_2h
  return (custom?.trim() || buildDefaultTemplate(type, org.vertical, lang))
}

export function renderSmsForConsultation(
  type: SmsMessageType,
  org: {
    name: string
    timezone: string
    /** Drives per-vertical default copy; absent/unknown → med-spa
     *  (byte-identical to today). */
    vertical?: string | null
    sms_template_confirmation?: string | null
    sms_template_confirmation_es?: string | null
    sms_template_reminder_24h?: string | null
    sms_template_reminder_2h?: string | null
  },
  /** preferred_language selects the customer-facing default language
   *  for non-med-spa verticals; med-spa ignores it (English-only). */
  contact: { first_name: string; preferred_language?: string | null },
  scheduledAt: string,
  /**
   * Phase 4 W5: when present, expands the {{manage_url}} placeholder
   * to "Manage: <url> " (with a trailing space). When absent — manual
   * bookings, reminders without a token — expands to "" so the
   * sentence reads cleanly. Null and undefined both treated as
   * "no link".
   */
  manageUrl?: string | null,
): string {
  const tz = org.timezone || 'America/New_York'
  const dt = new Date(scheduledAt)

  const date = dt.toLocaleDateString('en-US', {
    timeZone: tz,
    weekday: 'short',
    month:   'short',
    day:     'numeric',
  })

  const time = dt.toLocaleTimeString('en-US', {
    timeZone: tz,
    hour:     'numeric',
    minute:   '2-digit',
  })

  // Customer-facing language follows the CONTACT's preferred language,
  // not the owner's. Med-spa defaults ignore this (English-only), so it
  // only diverges the copy for the other verticals.
  const lang: SmsLang = contact.preferred_language === 'es' ? 'es' : 'en'
  const template = getTemplate(type, org, lang)

  const rendered = renderTemplate(template, {
    first_name:  contact.first_name,
    // {{clinic_name}} is the legacy alias (kept so existing custom
    // med-spa templates render); {{business_name}} is the neutral alias
    // the non-med-spa defaults use. Both resolve to the org's real name.
    clinic_name:   org.name,
    business_name: org.name,
    date,
    time,
    // Trailing space so the URL doesn't butt up against "Reply STOP".
    // When manageUrl is absent, collapse to nothing.
    manage_url:  manageUrl ? `${manageUrl} ` : '',
  })

  // Collapse any double-spaces produced by an empty {{manage_url}}
  // placeholder so the SMS reads naturally regardless of whether a
  // URL was injected.
  const collapsed = rendered.replace(/  +/g, ' ')

  // Belt-and-suspenders TCPA enforcement: sms-settings refuses to
  // save a custom template that lacks STOP, but a template could
  // have been written directly to the DB (manual SQL, an older
  // migration, etc.) or the placeholder substitution could in
  // principle elide the STOP phrase. Mirror the pattern used by
  // /api/leads/[id]/send-sms and append the footer when the
  // rendered body doesn't already carry it.
  const needsStop = !/\b(STOP|opt[\s-]?out|unsubscribe)\b/i.test(collapsed)
  return needsStop ? `${collapsed} Reply STOP to opt out.` : collapsed
}

export const DEFAULT_TEMPLATE_TEXT = DEFAULT_TEMPLATES
