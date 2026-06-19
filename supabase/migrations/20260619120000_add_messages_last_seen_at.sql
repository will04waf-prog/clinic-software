-- ============================================================
-- Track when a contact's conversation was last viewed, so the
-- leads list can render an unread-inbound indicator.
--
-- Org-shared (not per-user): a single column on contacts. If two
-- users in the same org view the same lead, either one opening
-- the conversation clears the indicator for both. Matches the
-- current single-clinic usage; switch to a per-user join table
-- only if that assumption breaks.
-- ============================================================

alter table public.contacts
  add column if not exists messages_last_seen_at timestamptz;

-- contacts_active was created with `select *` (see
-- 20260422150000_add_contact_imports.sql:86). Postgres freezes the
-- column list at view-creation time, so we must recreate the view
-- for the new column to flow through.
create or replace view public.contacts_active
  with (security_invoker = true) as
  select * from public.contacts
   where deleted_at is null;

grant select on public.contacts_active to authenticated, service_role;
