'use server'

/**
 * Phase 5 W2 — server actions for /settings/faqs.
 *
 * Backs the organizations.faqs jsonb column added in
 * 20260713100000_add_org_faqs.sql. The corpus feeds Layla's
 * lookup_faq voice tool (see /api/voice/tool/lookup-faq).
 *
 * The settings page is single-owner-edits-rarely so we use a
 * last-write-wins shape: every mutating action serializes the entire
 * faqs array back to the DB. No row-level optimistic concurrency —
 * if two browser tabs are editing the corpus simultaneously the
 * later save wins outright. That's an explicit tradeoff for keeping
 * the surface trivial; the alternative is a per-entry diff API that
 * isn't worth its weight for a corpus capped at 100.
 *
 * Authorization: owner-only, enforced server-side at the action
 * layer (page-level redirect is just defense in depth — RLS alone
 * is not the authorization boundary because we write via
 * supabaseAdmin to bypass org-level row policies).
 */

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

// Per-entry validation. The DB CHECK only enforces the 100-entry
// cap; everything else is the application's responsibility. Limits
// chosen to keep the spoken answer under ~3s of TTS and the question
// short enough to scan visually in the settings list.
const QUESTION_MAX = 200
const ANSWER_MAX   = 800
const TAG_MAX_LEN  = 40
const TAG_MAX_COUNT = 8

// Stable id pattern — uuid v4 in canonical 8-4-4-4-12 form. The
// voice-tool route only requires that id be a non-empty string but
// keeping it uuid-shaped means we can later add per-entry analytics
// (e.g. which FAQ was returned for which call) keyed by id without a
// migration to coerce stringly-typed ids.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const faqEntrySchema = z.object({
  id:       z.string().regex(UUID_RE, 'Invalid FAQ id'),
  question: z.string().trim().min(1, 'Question is required').max(QUESTION_MAX, `Question must be ${QUESTION_MAX} characters or fewer`),
  answer:   z.string().trim().min(1, 'Answer is required').max(ANSWER_MAX,   `Answer must be ${ANSWER_MAX} characters or fewer`),
  tags:     z.array(z.string().trim().min(1).max(TAG_MAX_LEN)).max(TAG_MAX_COUNT).default([]),
  position: z.number().int().nonnegative(),
}).strict()

export type FaqEntry = z.infer<typeof faqEntrySchema>

// Public shape returned to client UI. Keep it equal to FaqEntry so
// the round-trip is symmetric.
export type FaqRow = FaqEntry

export type FaqActionResult =
  | { ok: true; faqs: FaqRow[] }
  | { ok: false; error: string }

const MAX_FAQS = 100

// ----- Helpers ---------------------------------------------------------

/**
 * Look up the caller's profile and confirm owner + active. Returns
 * the organization_id on success, an error on any failure. Mirrored
 * exactly from updateClinicAddress so the authorization boundary is
 * identical across /settings/* server actions.
 */
async function requireOwner(): Promise<{ ok: true; organizationId: string } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { ok: false, error: 'Unauthorized' }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('organization_id, role, is_active')
    .eq('id', user.id)
    .single()
  if (profileError || !profile)    return { ok: false, error: 'Profile not found' }
  if (profile.is_active === false) return { ok: false, error: 'Account deactivated' }
  if (profile.role !== 'owner')    return { ok: false, error: 'Only the business owner can edit FAQs.' }
  if (!profile.organization_id)    return { ok: false, error: 'No organization on profile' }
  return { ok: true, organizationId: profile.organization_id as string }
}

/**
 * Read the current faqs array, defensively. The DB column default is
 * '[]' and the column is NOT NULL, but a hand-edited or pre-migration
 * row could be in any jsonb shape — collapse non-arrays to an empty
 * corpus rather than failing every page render.
 */
async function loadFaqs(organizationId: string): Promise<FaqRow[]> {
  const { data, error } = await supabaseAdmin
    .from('organizations')
    .select('faqs')
    .eq('id', organizationId)
    .single()
  if (error || !data) return []
  if (!Array.isArray(data.faqs)) return []
  // Pass each row through the schema so the client never sees an
  // entry it can't render — strip silently rather than refusing the
  // whole page. We deliberately do NOT mutate the DB here to fix
  // shape; the next save will normalize.
  const out: FaqRow[] = []
  for (const raw of data.faqs as unknown[]) {
    const parsed = faqEntrySchema.safeParse(raw)
    if (parsed.success) out.push(parsed.data)
  }
  out.sort((a, b) => a.position - b.position)
  return out
}

/** Strip empty tags + dedupe (case-insensitive). Mirrors the
 *  client-side input cleanup so a save round-trips cleanly. */
function normalizeTags(input: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of input) {
    const t = raw.trim()
    if (!t) continue
    const key = t.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(t)
    if (out.length >= TAG_MAX_COUNT) break
  }
  return out
}

/**
 * Reassign sequential position values 0..n-1 in the array order. We
 * do this on every write so a series of add/remove operations never
 * leaves position gaps the UI would have to render around.
 */
function repositionInPlace(rows: FaqRow[]): FaqRow[] {
  return rows.map((r, idx) => ({ ...r, position: idx }))
}

async function writeFaqs(organizationId: string, rows: FaqRow[]): Promise<FaqActionResult> {
  // Defensive cap: if a client sends more than MAX_FAQS we refuse
  // before the DB CHECK does — friendlier error, and avoids any
  // partial-write ambiguity. The DB CHECK is the authoritative gate.
  if (rows.length > MAX_FAQS) {
    return { ok: false, error: `At most ${MAX_FAQS} FAQs per business` }
  }
  const normalized = repositionInPlace(rows)
  const { error } = await supabaseAdmin
    .from('organizations')
    .update({ faqs: normalized })
    .eq('id', organizationId)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/settings/faqs')
  return { ok: true, faqs: normalized }
}

// ----- Actions ---------------------------------------------------------

/**
 * Add a new FAQ entry. Server generates the id so the client can't
 * collide with an existing one (or replay an old id to overwrite).
 */
export async function addFaq(input: {
  question: string
  answer:   string
  tags?:    string[]
}): Promise<FaqActionResult> {
  const auth = await requireOwner()
  if (!auth.ok) return auth

  const candidate: FaqEntry = {
    id:       randomUUID(),
    question: (input.question ?? '').trim(),
    answer:   (input.answer   ?? '').trim(),
    tags:     normalizeTags(Array.isArray(input.tags) ? input.tags : []),
    position: 0, // overwritten by repositionInPlace
  }
  const parsed = faqEntrySchema.safeParse(candidate)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid FAQ' }
  }

  const current = await loadFaqs(auth.organizationId)
  if (current.length >= MAX_FAQS) {
    return { ok: false, error: `At most ${MAX_FAQS} FAQs per business` }
  }
  // New entries land at the bottom of the list — owners who care
  // about order can drag/up-down to reposition. Appending preserves
  // the existing reading order so an add doesn't shuffle the corpus.
  const next = [...current, parsed.data]
  return writeFaqs(auth.organizationId, next)
}

/**
 * Update an existing FAQ entry by id. Last-write-wins on the whole
 * row; partial-update semantics aren't worth the complexity for a
 * corpus this small.
 */
export async function updateFaq(input: {
  id:       string
  question: string
  answer:   string
  tags?:    string[]
}): Promise<FaqActionResult> {
  const auth = await requireOwner()
  if (!auth.ok) return auth

  if (typeof input.id !== 'string' || !UUID_RE.test(input.id)) {
    return { ok: false, error: 'Invalid FAQ id' }
  }

  const current = await loadFaqs(auth.organizationId)
  const idx = current.findIndex((r) => r.id === input.id)
  if (idx === -1) return { ok: false, error: 'FAQ not found' }

  const candidate: FaqEntry = {
    id:       input.id,
    question: (input.question ?? '').trim(),
    answer:   (input.answer   ?? '').trim(),
    tags:     normalizeTags(Array.isArray(input.tags) ? input.tags : []),
    position: current[idx].position,
  }
  const parsed = faqEntrySchema.safeParse(candidate)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid FAQ' }
  }

  const next = current.slice()
  next[idx] = parsed.data
  return writeFaqs(auth.organizationId, next)
}

/**
 * Remove an FAQ entry by id. Idempotent: removing an already-gone id
 * is a no-op success so a double-click on the UI doesn't 500.
 */
export async function removeFaq(input: { id: string }): Promise<FaqActionResult> {
  const auth = await requireOwner()
  if (!auth.ok) return auth

  if (typeof input.id !== 'string' || !UUID_RE.test(input.id)) {
    return { ok: false, error: 'Invalid FAQ id' }
  }

  const current = await loadFaqs(auth.organizationId)
  const next = current.filter((r) => r.id !== input.id)
  // Even if the id wasn't present we still write — keeps the surface
  // idempotent and makes the response shape ({ faqs }) consistent.
  return writeFaqs(auth.organizationId, next)
}

/**
 * Reorder by an explicit id sequence. The client passes the full id
 * list in the desired order; the server validates that the set of
 * ids matches the current corpus exactly (no adds, no drops) before
 * applying the new positions. This rejects stale reorders from a
 * tab that hasn't seen a concurrent add/remove rather than silently
 * dropping rows.
 */
export async function reorderFaqs(input: { orderedIds: string[] }): Promise<FaqActionResult> {
  const auth = await requireOwner()
  if (!auth.ok) return auth

  if (!Array.isArray(input.orderedIds)) {
    return { ok: false, error: 'orderedIds must be an array' }
  }
  for (const id of input.orderedIds) {
    if (typeof id !== 'string' || !UUID_RE.test(id)) {
      return { ok: false, error: 'Invalid FAQ id in orderedIds' }
    }
  }

  const current = await loadFaqs(auth.organizationId)
  if (current.length !== input.orderedIds.length) {
    return { ok: false, error: 'Reorder list is out of date — refresh and try again' }
  }
  const byId = new Map(current.map((r) => [r.id, r]))
  const next: FaqRow[] = []
  for (const id of input.orderedIds) {
    const row = byId.get(id)
    if (!row) {
      return { ok: false, error: 'Reorder list is out of date — refresh and try again' }
    }
    next.push(row)
  }
  return writeFaqs(auth.organizationId, next)
}
