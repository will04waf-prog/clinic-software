-- ============================================================
-- AI Front-Desk Twin — Phase 1 Week 5
--
-- Adds a visibility window to ai_drafts. A draft can be created in
-- 'pending' state but deliberately held back from the human reviewer
-- (e.g. cool-down after a recent send, or a future-scheduled
-- nudge). When available_after is NULL the draft is visible
-- immediately, matching today's behavior — so this migration is a
-- non-breaking superset.
--
-- A partial index on (organization_id) WHERE state='pending' AND
-- (available_after IS NULL OR available_after <= now()) is NOT used
-- here because `now()` is non-IMMUTABLE and can't appear in a
-- partial-index predicate. Instead we keep a partial index on
-- pending rows only; the time predicate is cheap to apply at query
-- time because the candidate set is already small.
-- ============================================================

alter table public.ai_drafts
  add column if not exists available_after timestamptz;

-- Replace the existing contact_pending index with one that also
-- supports the org-wide aggregate /api/leads runs.
create index if not exists ai_drafts_org_pending_idx
  on public.ai_drafts (organization_id, available_after)
  where state = 'pending';

comment on column public.ai_drafts.available_after is
  'When set, the draft should be hidden from inbox surfaces until now() >= available_after. NULL = visible immediately.';
