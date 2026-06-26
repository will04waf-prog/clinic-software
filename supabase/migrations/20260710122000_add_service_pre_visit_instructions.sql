-- ============================================================
-- Phase 5 W2 — Pre-visit instructions on services
--
-- Adds a single text column that lets owners author the prep
-- text Layla reads aloud after a booking (e.g. "no retinol 48h
-- before microneedling", "shave the area for laser"). The voice
-- tool `pre_visit_instructions` reads from this column. When
-- null/empty the tool returns has_instructions:false and the
-- LLM falls back gracefully via prompt instruction.
--
-- - Owner-authored (not LLM-generated) → no clinical hallucination
--   risk.
-- - Service-generic, not patient-specific → no PHI in this column.
-- - 2000-char cap keeps spoken delivery bounded; longer prep flows
--   should live in a follow-up email/SMS link, not in voice.
-- - Single ADD COLUMN per line (repo convention — Supabase Studio's
--   SQL parser chokes on multi-line forms).
-- ============================================================

alter table public.services add column if not exists pre_visit_instructions text;

alter table public.services
  add constraint services_pre_visit_instructions_len
  check (pre_visit_instructions is null or length(pre_visit_instructions) <= 2000);

comment on column public.services.pre_visit_instructions is
  'Owner-authored prep text the AI receptionist (Layla) reads aloud after a booking. Service-generic; no PHI. Capped at 2000 chars.';
