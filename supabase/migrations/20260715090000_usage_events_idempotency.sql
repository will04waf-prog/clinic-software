-- ─────────────────────────────────────────────────────────────────────
-- M7 — Idempotency primitive for usage_events.
--
-- The M1 migration (20260714090000) created public.usage_events but
-- intentionally left the (organization_id, kind, source_ref) tuple
-- non-unique because the schema didn't yet have a recorder. Now that
-- M7 lands recordUsage() as the canonical writer, we need a uniqueness
-- guarantee for cron retries.
--
-- Why a SEPARATE migration (instead of editing 20260714090000):
--   - The M1 migration is frozen per the sweep ownership contract.
--     Any column or constraint added post-shipping must live in a
--     timestamp-later file so re-applying staging is safe.
--   - Partial unique indexes are idempotent on their own via
--     IF NOT EXISTS, so this re-applies cleanly.
--
-- Why a PARTIAL index (WHERE source_ref IS NOT NULL):
--   - Some legitimate usage events have no source_ref (e.g. ad-hoc
--     admin adjustments, manually-inserted rows during reconciliation).
--     Forcing source_ref NOT NULL would refuse those inserts; allowing
--     null + indexing only non-null rows lets us idempotency-protect
--     the cron-driven write path while leaving an escape hatch for
--     manual entries.
--   - The cron retries we're protecting against ALWAYS supply source_ref
--     (call_sid for voice, message.sid for SMS, init:<orgid> for rent),
--     so the partial-index coverage is 100% of the retry surface.
--
-- recordUsage() pairs this constraint with an `onConflict` ignore on
-- (organization_id, kind, source_ref) so a retry of the call-end
-- webhook for the same call_sid silently no-ops at the DB layer
-- rather than double-billing through Stripe.
-- ─────────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS usage_events_source_ref_uniq
  ON public.usage_events (organization_id, kind, source_ref)
  WHERE source_ref IS NOT NULL;

COMMENT ON INDEX public.usage_events_source_ref_uniq IS
  'Phase 5 M7: idempotency guard for recordUsage(). A retry that supplies the same (org, kind, source_ref) tuple raises 23505 and the upsert ignores it. Cron-driven writes always supply source_ref so the partial coverage is 100% of the retry surface.';
