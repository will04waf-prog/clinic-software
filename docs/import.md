# Bulk Contact Import

The `/import-contacts` wizard lets a clinic paste a spreadsheet or upload a
CSV, map columns to contact fields, and import up to 5,000 rows at a time.
Rows are chunked client-side (500 rows per POST) and sent sequentially to
`POST /api/contacts/import`.

## Status model

A row in `contact_imports` can be in one of four states:

| status        | meaning                                                                |
| ------------- | ---------------------------------------------------------------------- |
| `processing`  | Chunks are still being received. Only the originating user's session sees the wizard. |
| `completed`   | Last chunk landed. Counters are finalized. Import is eligible for undo. |
| `failed`      | Never set by the current code path. Reserved for a future "finalize rejected" case. |
| `undone`      | User clicked undo. Any still-in-flight chunks will be rejected by the main import route with a 409. |

Undo is allowed from `completed` or `processing`. Undoing a `processing`
import transitions it to `undone`, which closes the race window between
the first soft-delete sweep and any last-mile chunks still committing.

## Known limitations

### Refresh mid-import forfeits the wizard UI

The wizard is 100% client state. If the user reloads the tab or navigates
away while chunks are being sent:

- **What's preserved:** the `contact_imports` row (status `processing`) and
  every contact row that had already landed (tagged with `import_id`).
- **What's lost:** the progress bar, accumulated warnings, and the in-tab
  undo button. There is no cross-session resume of a wizard.

### Recovery paths when the wizard is lost

1. **If the import eventually finished server-side** (the last chunk was
   already sent before the refresh): the `contact_imports` row is in
   `completed` state with correct counters. The contacts are visible in
   `/leads`. Undo will be possible via PR D's activity-surfacing (see
   roadmap) or, until then, by calling `POST /api/contacts/import/undo`
   directly with the `import_id` retrieved from `contact_imports`.
2. **If the import was interrupted mid-stream** (chunks stopped arriving
   before the last one): the `contact_imports` row stays `processing`
   indefinitely. The contacts that did land are visible in `/leads`, just
   not badged as "from an in-progress import." Undo still works and will
   additionally transition the row to `undone`.

### Mobile not yet supported

Pasting multi-column data from a spreadsheet is awkward on phones and the
file picker on iOS Safari has spotty CSV support. The import wizard is
intentionally desktop-only in this PR — the sidebar link is desktop-only,
and the `<main>` layout pushes dashboard content behind a bottom-nav on
mobile that doesn't include an import entry.

If clinic usage patterns show mobile demand, a follow-up PR can add the
link to `src/components/layout/mobile-nav.tsx` and tune the textarea for
touch keyboards.

## Server-side contract

Client behaviors that the server enforces — changing either side breaks
the other:

- Chunk size ≤ 500 rows (`CHUNK_MAX` in
  `src/app/api/contacts/import/route.ts`). Client batches at exactly 500.
- Total rows ≤ 5,000 (`TOTAL_MAX`). Client rejects over-limit at the
  map step before sending anything.
- Rate limit: 3 imports per hour per organization. Server returns 429
  with a dynamic `Retry-After` computed from the oldest in-window
  import's `started_at`.
- Chunks are sent sequentially, not in parallel — the server's
  finalize-on-last-chunk logic relies on `chunk_index * CHUNK_MAX +
  rows.length >= total_rows` being monotonic.

## Undo invariants

- Soft-delete only. Rows get `deleted_at = now()`; the `contacts_active`
  view hides them from the rest of the app.
- 24h window measured from `completed_at` (done imports) or
  `started_at` (processing imports undone mid-flight).
- For processing imports, undo also flips status to `undone` and runs
  a second soft-delete sweep as a race-cleanup safeguard. The
  user-facing `undone_count` is from the first sweep only; the second
  sweep is housekeeping.
- Activity log entry `contacts_import_undone` records `import_id`,
  `undone_count`, and the `prior_status` at undo time — useful for
  auditing mid-flight cancels separately from after-the-fact undos.
