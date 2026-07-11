/**
 * WhatsApp owner-alert templates — Meta/Twilio registrable definitions.
 *
 * Outside the 24-hour WhatsApp "customer service window", Meta only
 * lets a business send PRE-APPROVED templates (freeform is blocked).
 * These bodies must match the approved templates CHARACTER-FOR-
 * CHARACTER, or the send fails with a template-mismatch error — so
 * this file is the single source of truth for both what we register
 * with Meta AND what we send at runtime.
 *
 * Variables are Meta's positional {{1}}, {{2}}, {{3}} style. Twilio's
 * Content API sends them as contentVariables = {"1":"…","2":"…"}.
 *
 * ─────────────────────────────────────────────────────────────────
 * HOW TO REGISTER (Twilio Console → Messaging → Content Template Builder)
 *
 * For EACH of the 6 rows below (3 types × EN/ES):
 *   1. Create content → choose "WhatsApp" → template type "Text".
 *   2. Set:
 *        Template name  = the `name` field below (lowercase_snake_case).
 *        Language       = the `language` field ('en' or 'es').
 *        Category       = the `category` field (UTILITY).
 *   3. Paste the `body` EXACTLY as written (including the {{1}} tokens,
 *      punctuation, and line breaks). Do not "improve" the wording —
 *      the runtime send compares against the approved copy.
 *   4. Add sample values for each variable when prompted (any realistic
 *      example is fine — they're only for Meta's review).
 *   5. Submit for WhatsApp approval. Approval usually lands in minutes
 *      to a few hours.
 *   6. When approved, Twilio shows a Content SID (starts with "HX…").
 *      Paste it into the env var named in `contentSidEnv` for that row.
 *
 * Then set WHATSAPP_ENABLED=true (it defaults to false; nothing sends
 * a WhatsApp until you do). Missing/blank SID env vars make the
 * template unavailable and the send falls back to SMS.
 * ─────────────────────────────────────────────────────────────────
 */

export type OwnerAlertType = 'job_summary' | 'booking_confirmation' | 'urgent_alert'
export type TemplateLang = 'en' | 'es'

export interface TemplateVariant {
  /** Meta template name (lowercase_snake_case, unique per language). */
  name: string
  language: TemplateLang
  category: 'UTILITY'
  /** Body with positional {{n}} variables. Must match Meta exactly. */
  body: string
  /** Env var holding the approved Twilio Content SID (HX…). */
  contentSidEnv: string
}

export interface OwnerAlertTemplate {
  type: OwnerAlertType
  /** What each {{n}} means, in order — used to build contentVariables. */
  variables: string[]
  en: TemplateVariant
  es: TemplateVariant
}

// {{1}} business name · {{2}} short PHI-free detail · {{3}} deep link.
// job_summary is template #1 and ends with the "reply OK" invitation
// that opens the 24-hour session so later alerts can go freeform.
export const OWNER_ALERT_TEMPLATES: Record<OwnerAlertType, OwnerAlertTemplate> = {
  job_summary: {
    type: 'job_summary',
    variables: ['business name', 'call outcome (e.g. "booked a job")', 'dashboard link'],
    en: {
      name: 'job_summary',
      language: 'en',
      category: 'UTILITY',
      body: 'Layla handled a call at {{1}}. Outcome: {{2}}. Details in your dashboard: {{3}}\n\nReply OK to get these updates right here on WhatsApp.',
      contentSidEnv: 'TWILIO_WA_JOB_SUMMARY_EN_SID',
    },
    es: {
      name: 'resumen_llamada',
      language: 'es',
      category: 'UTILITY',
      body: 'Layla atendió una llamada en {{1}}. Resultado: {{2}}. Detalles en su panel: {{3}}\n\nResponda OK para recibir estas novedades aquí en WhatsApp.',
      contentSidEnv: 'TWILIO_WA_JOB_SUMMARY_ES_SID',
    },
  },
  booking_confirmation: {
    type: 'booking_confirmation',
    variables: ['business name', 'booking detail (PHI-free)', 'calendar link'],
    // Meta rejected the short v1 ("too many variables for its length",
    // subcode 2388293) — the fixed text must be long relative to the
    // variable count, and no variable may start/end the body.
    en: {
      name: 'booking_confirmation',
      language: 'en',
      category: 'UTILITY',
      body: 'New booking at {{1}}: {{2}}. The appointment is on your calendar and reminders are scheduled automatically. See the details here: {{3}} (sent by Layla, your receptionist).',
      contentSidEnv: 'TWILIO_WA_BOOKING_CONFIRMATION_EN_SID',
    },
    es: {
      name: 'confirmacion_reserva',
      language: 'es',
      category: 'UTILITY',
      body: 'Nueva reserva en {{1}}: {{2}}. La cita ya está en su calendario y los recordatorios quedaron programados automáticamente. Vea los detalles aquí: {{3}} (enviado por Layla, su recepcionista).',
      contentSidEnv: 'TWILIO_WA_BOOKING_CONFIRMATION_ES_SID',
    },
  },
  // urgent_alert is fired by flag_urgent (trades vertical only — no
  // PHI on a landscaping/trades call), so it carries the CALLER'S PHONE
  // and their stated issue: the owner taps the number and calls back
  // without opening the dashboard (rider 2).
  //   {{1}} business name · {{2}} caller phone · {{3}} stated issue
  urgent_alert: {
    type: 'urgent_alert',
    variables: ['business name', 'caller phone number', 'stated issue'],
    // Meta rejected v1 ("Variables can't be at the start or end of the
    // template", subcode 2388299) — the body ended on {{2}}. Fixed text
    // now closes the message; caller phone + issue stay per rider 2.
    en: {
      name: 'urgent_alert',
      language: 'en',
      category: 'UTILITY',
      body: 'URGENT — {{1}}. A customer needs a callback right now. Issue: {{3}}. Call them back at {{2}} as soon as you can.',
      contentSidEnv: 'TWILIO_WA_URGENT_ALERT_EN_SID',
    },
    es: {
      name: 'alerta_urgente',
      language: 'es',
      category: 'UTILITY',
      body: 'URGENTE — {{1}}. Un cliente necesita que le devuelvan la llamada ahora mismo. Problema: {{3}}. Llámelo al {{2}} lo antes posible.',
      contentSidEnv: 'TWILIO_WA_URGENT_ALERT_ES_SID',
    },
  },
}

/** Resolve the registered variant for an alert type + language. */
export function templateVariant(type: OwnerAlertType, lang: TemplateLang): TemplateVariant {
  return OWNER_ALERT_TEMPLATES[type][lang]
}

/** The approved Content SID for a variant, or null when unregistered. */
export function templateContentSid(v: TemplateVariant): string | null {
  const sid = process.env[v.contentSidEnv]
  return sid && sid.trim() ? sid.trim() : null
}
