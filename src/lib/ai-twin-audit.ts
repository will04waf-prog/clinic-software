/**
 * AI Twin audit aggregator — Phase 2 W11.
 *
 * Pure helpers that shape activity_log rows + their referenced
 * ai_drafts rows into the AuditRow surface the /ai-twin/audit page
 * consumes. No DB access — the route wrapper at
 * /api/ai-twin/audit fetches the rows and calls formatAuditRow.
 *
 * Mirrors the voice-health.ts pattern: aggregator stays a pure data
 * function so it can be unit-tested without Supabase.
 *
 * Why activity_log rather than a dedicated audit table:
 *   The W7 voice-training pipeline and W8 health aggregator already
 *   read activity_log for ai_draft_sent/edited/rejected/auto_sent.
 *   Putting flags + settings changes in the same table means the
 *   retraining signal lives in one place, indexed by the partial
 *   index added in the W11 migration.
 *
 * Safety dependency note:
 *   The safety-incidents filter expects W9's auto-send refusal path
 *   to write metadata.auto_send_skipped_reason='safety_trigger_matched'
 *   on the ai_draft_generated activity_log row. If a future W9 change
 *   drops that field, classifySafetyIncident's 'safety_trigger_held'
 *   branch under-counts; the fallback signal would be reading
 *   ai_drafts.context_snapshot.auto_send_skipped_reason directly,
 *   which is left to the caller to wire in if needed.
 */

import type { VoiceExampleClass } from '@/lib/voice-profile'

// ─── Actions we surface in the audit ───────────────────────────────

export const AUDIT_ACTIONS = [
  'ai_draft_generated',
  'ai_draft_sent',
  'ai_draft_edited',
  'ai_draft_rejected',
  'ai_twin_auto_sent',
  'ai_twin_auto_sent_flagged',
  'ai_twin_auto_send_settings_changed',
  // W12 — shadow + rollout signals. Kept alongside the message
  // actions so the audit page can surface what the dial actually
  // did. The W11 partial index WHERE clause must include these.
  'ai_twin_auto_send_shadow_simulated',
  'ai_twin_auto_send_rollout_throttled',
  // Tier-gating — runtime refusal because the org's effective tier
  // doesn't include autonomous send (e.g. downgraded from Scale).
  'ai_twin_auto_send_tier_blocked',
] as const

export type AuditAction = typeof AUDIT_ACTIONS[number]

export function isAuditAction(v: unknown): v is AuditAction {
  return typeof v === 'string' && (AUDIT_ACTIONS as ReadonlyArray<string>).includes(v)
}

// ─── Flag reason taxonomy ──────────────────────────────────────────

export const FLAG_REASON_CODES = [
  'inaccurate',
  'off_tone',
  'sensitive',
  'wrong_class',
  'other',
] as const

export type FlagReasonCode = typeof FLAG_REASON_CODES[number]

export function isFlagReasonCode(v: unknown): v is FlagReasonCode {
  return typeof v === 'string' && (FLAG_REASON_CODES as ReadonlyArray<string>).includes(v)
}

/**
 * UI labels — honest copy. "Wrong message class" not "Misclassified".
 * "Off tone" not "Tone violation". These ship in the popover radio
 * group and in any future surface that displays reason codes.
 */
export const FLAG_REASON_LABEL: Record<FlagReasonCode, string> = {
  inaccurate:  'Inaccurate or wrong facts',
  off_tone:    'Wrong tone or voice',
  sensitive:   'Sensitive — should not have sent',
  wrong_class: 'Replied to the wrong kind of message',
  other:       'Other',
}

// ─── Pagination tunables ───────────────────────────────────────────

export const DEFAULT_PAGE_SIZE = 25
export const MAX_PAGE_SIZE     = 100

// ─── Filter parsing ────────────────────────────────────────────────

export interface AuditFilters {
  actions: AuditAction[] | null
  from: string | null
  to: string | null
  message_class: VoiceExampleClass | null
  contact_id: string | null
  safety_only: boolean
  page: number
  page_size: number
}

const VOICE_EXAMPLE_CLASS_VALUES: ReadonlyArray<VoiceExampleClass> = [
  'greeting',
  'faq',
  'follow_up',
  'consult_confirm',
  'follow_up_cold',
  'custom',
]

function isVoiceClass(v: string): v is VoiceExampleClass {
  return (VOICE_EXAMPLE_CLASS_VALUES as ReadonlyArray<string>).includes(v)
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface ParseAuditFiltersResult {
  ok: true
  filters: AuditFilters
}
export interface ParseAuditFiltersError {
  ok: false
  errors: string[]
}

/**
 * Parse + validate the audit page's URL search params. Lenient on
 * unknown values (drop them) but strict on shape — bad page numbers
 * or bad UUIDs return errors so the caller can 400. Always returns
 * a defined page+page_size so the route doesn't need to clamp again.
 */
export function parseAuditFilters(sp: URLSearchParams): ParseAuditFiltersResult | ParseAuditFiltersError {
  const errors: string[] = []

  let actions: AuditAction[] | null = null
  const actionRaw = sp.get('action')
  if (actionRaw) {
    const candidate = actionRaw
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
    const ok = candidate.filter(isAuditAction)
    actions = ok.length > 0 ? Array.from(new Set(ok)) : null
  }

  const from = parseIso(sp.get('from'), 'from', errors)
  const to   = parseIso(sp.get('to'),   'to',   errors)

  let message_class: VoiceExampleClass | null = null
  const mcRaw = sp.get('message_class')
  if (mcRaw) {
    if (isVoiceClass(mcRaw)) {
      message_class = mcRaw
    } else {
      // Lenient: unknown class → drop, don't 400.
    }
  }

  let contact_id: string | null = null
  const cidRaw = sp.get('contact_id')
  if (cidRaw) {
    if (UUID_RE.test(cidRaw)) {
      contact_id = cidRaw
    } else {
      errors.push('contact_id must be a UUID')
    }
  }

  const safety_only = sp.get('safety_only') === '1'

  let page = 1
  const pageRaw = sp.get('page')
  if (pageRaw !== null && pageRaw !== '') {
    const n = Number(pageRaw)
    if (!Number.isFinite(n) || n < 1 || !Number.isInteger(n)) {
      errors.push('page must be a positive integer')
    } else {
      page = n
    }
  }

  let page_size = DEFAULT_PAGE_SIZE
  const psRaw = sp.get('page_size')
  if (psRaw !== null && psRaw !== '') {
    const n = Number(psRaw)
    if (!Number.isFinite(n) || n < 1 || !Number.isInteger(n)) {
      errors.push('page_size must be a positive integer')
    } else {
      page_size = Math.min(MAX_PAGE_SIZE, n)
    }
  }

  if (errors.length > 0) return { ok: false, errors }

  return {
    ok: true,
    filters: {
      actions,
      from,
      to,
      message_class,
      contact_id,
      safety_only,
      page,
      page_size,
    },
  }
}

function parseIso(raw: string | null, name: string, errors: string[]): string | null {
  if (raw === null || raw === '') return null
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) {
    errors.push(`${name} must be an ISO 8601 timestamp`)
    return null
  }
  return d.toISOString()
}

// ─── Shaping helpers ───────────────────────────────────────────────

export interface RawActivityLogRow {
  id: string
  organization_id: string
  contact_id: string | null
  action: string
  metadata: Record<string, unknown> | null
  created_at: string
}

export interface RawDraftRow {
  id: string
  state: string
  draft_body: string
  edit_distance: number | null
  guardrail_violation: string | null
  context_snapshot: Record<string, unknown> | null
}

export interface RawContactRow {
  id: string
  first_name: string | null
  last_name: string | null
}

export interface AuditRowContact {
  id: string
  first_name: string | null
  last_name: string | null
}

export interface AuditRowDraft {
  id: string
  state: string
  draft_body: string
  guardrail_violation: string | null
  edit_distance: number | null
  message_class: string | null
  voice_examples_used: number | null
}

export type SafetyIncidentKind =
  | 'guardrail_failed'
  | 'safety_trigger_held'
  | 'flagged_after_send'

export interface AuditRow {
  id: string
  created_at: string
  action: AuditAction
  contact: AuditRowContact | null
  draft: AuditRowDraft | null
  metadata: Record<string, unknown>
  safety_incident_kind: SafetyIncidentKind | null
  already_flagged_by_me: boolean
}

export interface AuditPage {
  rows: AuditRow[]
  total: number
  page: number
  page_size: number
}

/**
 * Decide whether a row counts as a safety incident, and if so which
 * kind. Returns null for benign rows.
 *
 * Three kinds, in checked order:
 *   1. `guardrail_failed` — the draft was killed before any send by a
 *      guardrail rule (banned phrase, quoted price, etc).
 *   2. `safety_trigger_held` — the auto-send pipeline refused to fire
 *      because classifyInbound flagged a safety_trigger. The held
 *      draft sits in 'pending' state for human review.
 *   3. `flagged_after_send` — owner explicitly flagged an autonomous
 *      send as wrong. This is the *highest-signal* incident kind
 *      because a human said "this was incorrect."
 */
export function classifySafetyIncident(row: {
  action: AuditAction
  metadata: Record<string, unknown> | null
  draft: { state: string; guardrail_violation: string | null } | null
}): SafetyIncidentKind | null {
  if (row.action === 'ai_twin_auto_sent_flagged') return 'flagged_after_send'

  if (row.draft && row.draft.state === 'guardrail_failed') return 'guardrail_failed'
  if (row.draft && row.draft.guardrail_violation) return 'guardrail_failed'

  const skipped = row.metadata?.['auto_send_skipped_reason']
  if (typeof skipped === 'string' && skipped === 'safety_trigger_matched') {
    return 'safety_trigger_held'
  }

  return null
}

/**
 * Shape a single activity_log row + its joined draft + contact into
 * the AuditRow the client consumes. Pure — no DB.
 *
 * `flaggedDraftIdsByMe` is the set of draft_ids the caller has
 * already flagged; we mark `already_flagged_by_me` so the FlagDraftButton
 * can render its 'flagged' state without a separate per-row query.
 */
export function formatAuditRow(
  row: RawActivityLogRow,
  draftsById: Map<string, RawDraftRow>,
  contactsById: Map<string, RawContactRow>,
  flaggedDraftIdsByMe: Set<string>,
): AuditRow | null {
  if (!isAuditAction(row.action)) return null

  const metadata = row.metadata ?? {}

  // ── Resolve draft ─────────────────────────────────────────────
  const draftId = pickString(metadata['draft_id'])
  let draft: AuditRowDraft | null = null
  if (draftId) {
    const raw = draftsById.get(draftId)
    if (raw) {
      const cs = raw.context_snapshot ?? {}
      draft = {
        id: raw.id,
        state: raw.state,
        draft_body: raw.draft_body,
        guardrail_violation: raw.guardrail_violation,
        edit_distance: raw.edit_distance,
        message_class:
          pickString(cs['voice_class']) ??
          pickString(cs['classified_class']) ??
          pickString(metadata['message_class']) ??
          null,
        voice_examples_used: pickNumber(cs['voice_examples_used']),
      }
    }
  }

  // ── Resolve contact ───────────────────────────────────────────
  let contact: AuditRowContact | null = null
  const cid =
    row.contact_id ??
    pickString(metadata['contact_id']) ??
    null
  if (cid) {
    const raw = contactsById.get(cid)
    if (raw) {
      contact = {
        id: raw.id,
        first_name: raw.first_name,
        last_name:  raw.last_name,
      }
    } else {
      // Contact deleted but we still know its id — surface as
      // anonymous rather than dropping the row.
      contact = { id: cid, first_name: null, last_name: null }
    }
  }

  const safety_incident_kind = classifySafetyIncident({
    action: row.action,
    metadata,
    draft: draft ? { state: draft.state, guardrail_violation: draft.guardrail_violation } : null,
  })

  const already_flagged_by_me = draftId ? flaggedDraftIdsByMe.has(draftId) : false

  return {
    id: row.id,
    created_at: row.created_at,
    action: row.action,
    contact,
    draft,
    metadata,
    safety_incident_kind,
    already_flagged_by_me,
  }
}

// ─── Internal coercion helpers ─────────────────────────────────────

function pickString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}
function pickNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

// ─── Pagination math ───────────────────────────────────────────────

export interface RangeBounds {
  from: number
  to: number
}

/**
 * Translate (page, page_size) into the inclusive zero-based [from,to]
 * range Supabase's `.range()` consumes. Page numbers are 1-based for
 * URL friendliness.
 */
export function paginationRange(page: number, pageSize: number): RangeBounds {
  const safePage = Math.max(1, Math.floor(page))
  const safeSize = Math.max(1, Math.floor(pageSize))
  const from = (safePage - 1) * safeSize
  const to = from + safeSize - 1
  return { from, to }
}
