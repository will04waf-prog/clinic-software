/**
 * Shared input validators. Kept intentionally small and pragmatic —
 * these run against untrusted paste/CSV data during bulk import, and
 * against user-entered contact forms. They are not a substitute for
 * DB-level constraints (unique index on email, NOT NULL on first_name).
 */

/**
 * Pragmatic email check. Not RFC 5321 compliant — we just reject the
 * shapes clinics routinely paste by mistake (trailing commas, spaces,
 * missing @, missing tld). Strict enough for dedupe; loose enough not
 * to false-reject rare-but-valid addresses.
 *
 * Returns true iff input looks like `local@domain.tld` (no whitespace).
 */
export function validateEmail(raw: string | null | undefined): boolean {
  if (!raw) return false
  const trimmed = raw.trim()
  if (trimmed.length === 0 || trimmed.length > 254) return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)
}

/**
 * Normalize a phone string to E.164 (+<digits>).
 *
 * Rules:
 *   - Strip everything except digits and a leading '+'
 *   - 10 digits → assume US/CA, prefix +1
 *   - 11 digits starting with 1 → prefix +
 *   - 11–15 digits (not US) → prefix + as-is
 *   - <10 or >15 digits → null (caller decides whether to warn/skip)
 *
 * Returns null on unparseable input so callers can branch instead of
 * accidentally writing a malformed number to the DB.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null
  const trimmed = String(raw).trim()
  if (trimmed.length === 0) return null

  const hadPlus = trimmed.startsWith('+')
  const digits = trimmed.replace(/\D/g, '')

  if (digits.length < 10 || digits.length > 15) return null

  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`

  // 11–15 digits, non-US. Trust the input if it had a leading '+'; otherwise
  // still prefix '+' — we've already bounded length, so this is the best guess.
  return hadPlus ? `+${digits}` : `+${digits}`
}
