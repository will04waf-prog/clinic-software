-- ─────────────────────────────────────────────────────────────────────
-- Audit perf fixes M5 + L3 — composite indexes for the hot polled reads.
--
-- These are pure performance (no correctness/behavior change); code works
-- without them, just with in-memory sorts. NOT YET APPLIED to prod — hold
-- for owner sign-off (see audit Phase 2 notes).
--
-- M5 — messages(organization_id, direction, created_at DESC):
--   /api/leads (polled ~20s) and /api/dashboard/morning (polled ~60s) both
--   filter messages by organization_id + direction/channel and sort by
--   created_at. With only the org-only index, Postgres heap-filters and
--   in-memory sorts the org's matched rows. This composite serves both the
--   filter and the sort directly.
--
-- L3 — contacts(organization_id, last_activity_at DESC):
--   The primary contact-list reads (/api/leads, pipeline board) filter by
--   org and ORDER BY last_activity_at desc; last_activity_at is currently
--   unindexed, forcing an in-memory sort of the org's active contacts on
--   every list load / 20s poll.
--
-- NOTE: for a large prod table, prefer `CREATE INDEX CONCURRENTLY` (run
-- outside a transaction) to avoid a write lock. Written as plain CREATE
-- INDEX here because the Supabase migration runner wraps in a transaction;
-- at current single-clinic scale the lock is negligible. Revisit if applied
-- against a high-volume table.
-- ─────────────────────────────────────────────────────────────────────

create index if not exists messages_org_direction_created_idx
  on public.messages (organization_id, direction, created_at desc);

create index if not exists contacts_org_last_activity_idx
  on public.contacts (organization_id, last_activity_at desc);
