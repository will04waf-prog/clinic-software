-- Phase 5 W2 — Per-org FAQ corpus for Layla's `lookup_faq` voice tool.
--
-- Layla already grounds hours/services/prep/directions via dedicated
-- tools (get_context, pre_visit_instructions, give_directions). What
-- she keeps falling back to `take_message` on is everything else: the
-- "do you accept Care Credit?", "is parking free?", "do you sell
-- gift cards?", "what's your cancellation policy?", "are you the same
-- clinic as the one in midtown?" long tail. This migration lets each
-- owner author that residual FAQ corpus and have Layla fuzzy-match
-- caller questions against it (see /api/voice/tool/lookup-faq).
--
-- Storage choice: jsonb column on organizations rather than a separate
-- `org_faqs` table.
--
--   - Volume is tiny per org (we cap at 100 entries, expected <20 in
--     practice). A child table would force a join on every Vapi tool
--     call and burn a round-trip for what is effectively per-org
--     static config.
--   - The settings UI loads + saves the whole array each edit
--     (last-write-wins is fine for a single-owner-edits-rarely
--     surface — same pattern services_card uses for procedures).
--   - RLS becomes free: existing organization-level policies already
--     gate read/write of organizations.
--   - The voice tool reads the entire array anyway to fuzzy-rank — no
--     index would help.
--
-- Shape (validated at the application layer; the DB only enforces the
-- count cap because that's the only invariant cheap to express in SQL
-- and important enough to defend against — a runaway settings page or
-- malicious bulk-import could otherwise inflate the row past the
-- per-row size threshold and slow every lookup_faq call):
--
--   [
--     {
--       id:       uuid,         // stable id, generated client-side
--       question: text (<=200), // canonical phrasing for matching
--       answer:   text (<=800), // verbatim spoken/textable reply
--       tags:     text[],       // optional aliases ("insurance", "carecredit")
--       position: int           // 0-based sort order
--     },
--     ...
--   ]
--
-- The 100-entry cap is enforced via a CHECK on
-- jsonb_array_length(faqs). Beyond that, finer per-entry validation
-- (string length, key shape) lives in the server action / Vapi tool
-- route, not in SQL — jsonb path constraints are expensive to read in
-- review and we own both write surfaces.
--
-- Default '[]'::jsonb so existing orgs are immediately usable and so
-- the voice tool can do an array iteration without a null branch.
-- IF NOT EXISTS keeps this migration idempotent under partial reruns.

alter table public.organizations
  add column if not exists faqs jsonb not null default '[]'::jsonb;

-- The DO block is the idempotent pattern for ALTER TABLE ADD
-- CONSTRAINT — `ADD CONSTRAINT IF NOT EXISTS` isn't supported on
-- Postgres < 16 so we guard manually. Constraint name is stable so a
-- rerun is a no-op.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'organizations_faqs_max_count'
      and conrelid = 'public.organizations'::regclass
  ) then
    alter table public.organizations
      add constraint organizations_faqs_max_count
      check (jsonb_typeof(faqs) = 'array' and jsonb_array_length(faqs) <= 100);
  end if;
end$$;

comment on column public.organizations.faqs is
  'Phase 5 W2: per-org FAQ corpus for Layla''s lookup_faq voice tool. jsonb array of { id, question, answer, tags, position }. Capped at 100 entries by CHECK constraint. Schema validation otherwise lives at the application layer.';
