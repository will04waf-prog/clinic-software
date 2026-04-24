-- Allow contact_imports.status = 'undone', used when an import is undone
-- while still in the 'processing' state. PR C's undo flow (and PR D's
-- cross-session undo surfacing) need this state so the main import
-- route can distinguish "user cancelled via undo" from "completed but
-- reversed" — different error messages, different UX.
--
-- This swaps the CHECK constraint. No data migration needed — existing
-- rows all have status in ('processing','completed','failed'), all of
-- which remain valid.

begin;

alter table public.contact_imports
  drop constraint contact_imports_status_check;

alter table public.contact_imports
  add constraint contact_imports_status_check
  check (status in ('processing','completed','failed','undone'));

commit;

-- ── Verification ─────────────────────────────────────────────
-- (a) Constraint swapped:
--   select conname, pg_get_constraintdef(oid)
--     from pg_constraint
--    where conrelid = 'public.contact_imports'::regclass
--      and contype = 'c'
--      and conname = 'contact_imports_status_check';
--   -- expect: definition includes 'undone'
--
-- (b) Existing rows still valid (none should error):
--   select count(*) from public.contact_imports;
--   -- no constraint violation at query time
--
-- (c) Test the new value works:
--   insert into public.contact_imports (organization_id, user_id, row_count, source, status)
--   values (
--     (select id from public.organizations limit 1),
--     (select id from public.profiles limit 1),
--     0, 'paste', 'undone'
--   ) returning id;
--   -- expect: row created
--   -- cleanup: delete from public.contact_imports where status='undone' and row_count=0;
