/**
 * Lightweight i18n for the CRM-pivot loop surfaces — no framework, no
 * locale routing. Spanish is the DEFAULT; English is a toggle. A locale
 * selects a fully-typed message object (see es.ts / en.ts); components
 * read `t.signup.emailLabel` directly, so there is no runtime key lookup
 * and missing keys are compile errors.
 *
 * Locale source of truth:
 *   - Authenticated app: organizations.owner_language ('es' | 'en').
 *   - Public/unauthed (signup, client links): default 'es', overridable
 *     by a UI toggle or a ?lang= query param.
 *
 * The legacy med-spa dashboard does NOT use this — it stays English.
 */
import { es, type Messages } from './es'
import { en } from './en'

export type Locale = 'es' | 'en'
export const DEFAULT_LOCALE: Locale = 'es'
export const LOCALES: readonly Locale[] = ['es', 'en']

const CATALOG: Record<Locale, Messages> = { es, en }

/** Return the fully-typed message object for a locale (defaults to es). */
export function dict(locale: Locale = DEFAULT_LOCALE): Messages {
  return CATALOG[locale] ?? CATALOG[DEFAULT_LOCALE]
}

/** Coerce any input (owner_language column, ?lang= param, null) to a
 *  valid Locale, defaulting to Spanish. */
export function resolveLocale(input: string | null | undefined): Locale {
  return input === 'en' ? 'en' : 'es'
}

export type { Messages }
