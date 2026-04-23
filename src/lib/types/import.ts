/**
 * Shared types for the bulk-contact-import flow.
 *
 * Used by:
 *   - POST /api/contacts/import
 *   - POST /api/contacts/import/undo
 *   - /import-contacts UI (PR C)
 */

export type ContactField =
  | 'first_name'
  | 'last_name'
  | 'email'
  | 'phone'
  | 'source'
  | 'procedure_interest'
  | 'notes'
  | 'ignore'

/**
 * How to handle an incoming row whose (org, lower(email)) already exists.
 *   - skip   : leave the existing row alone; count it as skipped
 *   - update : merge new row into existing (fill-if-empty for scalars, union-merge for procedure_interest)
 *
 * Note: "duplicate as new" was dropped — the partial unique index would reject it.
 */
export type DupeStrategy = 'skip' | 'update'

/**
 * A single parsed row the client is submitting. All values are post-mapping
 * (the mapping step on the client has already bound columns → ContactField).
 * Values are raw strings; the server normalizes phone, trims, validates email.
 */
export interface ImportRow {
  first_name?: string
  last_name?: string
  email?: string
  phone?: string
  source?: string
  procedure_interest?: string[]
  notes?: string
}

export interface ImportChunkRequest {
  /** UUID of an existing contact_imports row. Required on chunk_index > 0. Server creates it on chunk_index=0. */
  import_id?: string
  /** 0-indexed chunk position. Server treats chunk_index=0 as "start of import". */
  chunk_index: number
  /** Total rows across all chunks — declared by client on chunk 0, used for rate/size enforcement. */
  total_rows: number
  /** Dedupe strategy for this import. Locked at chunk 0; ignored on subsequent chunks. */
  dupe_strategy: DupeStrategy
  /** Source marker for audit; locked at chunk 0. */
  source: 'paste' | 'csv'
  /** Rows in this chunk (max 500). */
  rows: ImportRow[]
}

export type ImportRowReason =
  | 'empty_row'
  | 'invalid_email'
  | 'invalid_phone'
  | 'missing_first_name'
  | 'duplicate_in_paste'
  | 'existing_contact_skipped'
  /**
   * Row reached INSERT but was dropped by the DB-level partial unique
   * index (via the ignore-dupes RPC's ON CONFLICT DO NOTHING). We
   * don't know which specific row(s) collided because the driver
   * doesn't return that — so this reason always appears at chunk
   * granularity with row_index=-1 and a count in `detail`.
   */
  | 'silent_dupe_skipped'

export interface ImportRowWarning {
  /**
   * 0-based index within the chunk's `rows` array.
   *
   * Convention: `-1` means "no specific row" — the warning applies to
   * the whole chunk. Used when the source of the warning can't be
   * traced back to a single input row (e.g. silent_dupe_skipped, where
   * the RPC returns a count of collided rows but not their identities).
   * When `row_index === -1`, `detail` carries the count or other
   * chunk-level context.
   */
  row_index: number
  reason: ImportRowReason
  detail?: string
}

export interface ImportChunkResponse {
  import_id: string
  chunk_index: number
  /** Rows inserted as new contacts in THIS chunk only. */
  imported: number
  /** Rows merged into an existing contact in THIS chunk only. */
  updated: number
  /** Rows skipped in THIS chunk only — see `warnings` for per-row detail. */
  skipped: number
  /** Per-row notes for THIS chunk. Client should accumulate across chunks. */
  warnings: ImportRowWarning[]
  /** True iff this was the final chunk. Server-flagged, not derived client-side. */
  complete: boolean
}

export interface ImportUndoRequest {
  import_id: string
}

export interface ImportUndoResponse {
  import_id: string
  undone_count: number
}
