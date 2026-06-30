-- ─────────────────────────────────────────────────────────────────────
-- Make usage_events dedup index usable by the recordUsage() upsert.
--
-- recordUsage() (src/lib/billing/metered-usage.ts) inserts billable
-- usage with:
--   .upsert({...}, { onConflict: 'organization_id,kind,source_ref',
--                    ignoreDuplicates: true })
-- which PostgREST compiles to
--   INSERT ... ON CONFLICT (organization_id, kind, source_ref) DO NOTHING.
--
-- For ON CONFLICT to infer a target, a matching unique index must exist.
-- The two indexes we had —
--   usage_events_dedupe_uniq     (M1, 20260714090000)
--   usage_events_source_ref_uniq (M7, 20260715090000)
-- — were BOTH partial (WHERE source_ref IS NOT NULL). PostgREST's
-- onConflict only emits the column list, never the partial predicate, so
-- Postgres could not match either index and every metered upsert raised:
--   "there is no unique or exclusion constraint matching the ON CONFLICT
--    specification"
-- => voice minutes / SMS segments silently failed to record (undercharge).
--
-- Fix: one NON-partial unique index on the same tuple. NULLs are still
-- distinct (PG default), so manual adjustment rows with a null source_ref
-- remain un-deduped exactly as the partial index intended — but now the
-- index is inferrable by ON CONFLICT. Replaces both redundant partials.
--
-- Safe: the partial index already guaranteed non-null source_ref tuples
-- are unique, so no duplicates exist to block the full index build.
-- ─────────────────────────────────────────────────────────────────────

create unique index if not exists usage_events_org_kind_source_ref_uniq
  on public.usage_events (organization_id, kind, source_ref);

drop index if exists public.usage_events_dedupe_uniq;
drop index if exists public.usage_events_source_ref_uniq;

comment on index public.usage_events_org_kind_source_ref_uniq is
  'Idempotency guard for recordUsage(). Non-partial so PostgREST ON CONFLICT (organization_id,kind,source_ref) can infer it. NULL source_ref rows stay distinct (manual-adjustment escape hatch).';
