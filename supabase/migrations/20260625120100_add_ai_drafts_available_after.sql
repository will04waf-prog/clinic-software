-- ============================================================
-- ai_drafts.available_after — Phase 1 Week 4
--
-- When an inbound arrives during the org's configured quiet hours we
-- still generate the draft (so the model context is fresh and the
-- human-in-the-loop loop is uninterrupted in the morning), but we
-- defer making it visible in the inbox until the quiet window ends.
-- NULL = immediately visible. A timestamp in the future = hidden
-- until that moment.
--
-- The pending-draft read path filters on (available_after IS NULL OR
-- available_after <= now()).
-- ============================================================

alter table public.ai_drafts
  add column if not exists available_after timestamptz;

comment on column public.ai_drafts.available_after is
  'When the draft becomes visible to the inbox. NULL = immediately. Used by quiet-hours scheduling.';

-- We considered tightening ai_drafts_contact_pending_idx with an
-- additional predicate on available_after, but Postgres can't put
-- now() in a partial-index predicate. The existing
-- (contact_id, generated_at desc) WHERE state='pending' index is
-- sufficient — the available_after filter on the read path applies
-- after the index lookup and the candidate set per contact is small.
