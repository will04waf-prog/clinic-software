/**
 * Shared password-strength validator.
 * Returns null if valid, otherwise a user-facing error string.
 */
export function validatePassword(pw: string): string | null {
  if (pw.length < 8) return 'Password must be at least 8 characters.'
  if (!/[a-zA-Z]/.test(pw)) return 'Password must include at least one letter.'
  if (!/\d/.test(pw)) return 'Password must include at least one number.'
  return null
}
