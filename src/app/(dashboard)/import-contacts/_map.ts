/**
 * Header → ContactField suggestion for the import wizard's Map step.
 *
 * The user can override every row, so this is a best-effort heuristic
 * that covers the common cases (Google Sheets / Excel exports from
 * CRMs, event registration tools, etc.). Unmatched headers default
 * to 'ignore' so a column never gets silently misclassified.
 *
 * Matching is strict-equals after alphanum-normalizing the header
 * (lowercase + strip non-alphanumerics). Fuzzy distance matching was
 * considered and rejected — it makes false-positive column mappings
 * easy, and the user sees the picker anyway so they can correct.
 *
 * Each ContactField is assigned at most once. If "Email" and "Email Address"
 * both appear, only the first header wins 'email'; the second falls back
 * to 'ignore' and the user can retarget manually.
 */

import type { ContactField } from '@/lib/types/import'

// Lowercased, alphanum-only synonyms. Order within each array doesn't
// matter — we test membership via Array.includes.
const SYNONYMS: Record<Exclude<ContactField, 'ignore'>, string[]> = {
  first_name:         ['firstname', 'first', 'given', 'givenname', 'fname'],
  last_name:          ['lastname', 'last', 'surname', 'family', 'familyname', 'lname'],
  email:              ['email', 'emailaddress', 'mail'],
  phone:              ['phone', 'mobile', 'cell', 'telephone', 'tel', 'phonenumber'],
  source:             ['source', 'leadsource', 'referral', 'referredby'],
  procedure_interest: ['procedure', 'procedures', 'interest', 'interestedin', 'service'],
  notes:              ['notes', 'note', 'comment', 'comments', 'remarks'],
}

function normalize(h: string): string {
  return (h ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')
}

export function suggestMapping(headers: string[]): ContactField[] {
  const used = new Set<ContactField>()
  return headers.map((h) => {
    const n = normalize(h)
    if (!n) return 'ignore'
    for (const field of Object.keys(SYNONYMS) as Exclude<ContactField, 'ignore'>[]) {
      if (used.has(field)) continue
      if (SYNONYMS[field].includes(n)) {
        used.add(field)
        return field
      }
    }
    return 'ignore'
  })
}
