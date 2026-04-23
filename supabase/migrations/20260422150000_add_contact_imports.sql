-- Bulk contact import infrastructure.
--
-- Adds:
--   1. contacts.deleted_at           — soft-delete column (for Undo Import)
--   2. contact_imports                — tracking table for bulk imports
--   3. contacts.import_id             — FK back to the import that created each row
--   4. contacts_active view           — read-side projection hiding soft-deleted rows
--   5. partial unique index           — enforces (org, lower(email)) uniqueness
--
-- Convention from this point:
--   READ  queries use public.contacts_active
--   WRITE queries (insert/update/delete) stay on public.contacts
--   The import + undo routes are the only reads that target the base table.

begin;

-- ── 1. Soft-delete column ────────────────────────────────────
alter table public.contacts
  add column deleted_at timestamptz;

-- ── 2. contact_imports tracking table ────────────────────────
create table public.contact_imports (
  id               uuid         primary key default gen_random_uuid(),
  organization_id  uuid         not null references public.organizations(id) on delete cascade,
  user_id          uuid         not null references auth.users(id),
  started_at       timestamptz  not null default now(),
  completed_at     timestamptz,
  row_count        int          not null default 0,
  imported_count   int          not null default 0,
  skipped_count    int          not null default 0,
  source           text         not null check (source in ('paste','csv')),
  status           text         not null default 'processing'
                                check (status in ('processing','completed','failed')),
  error_log        jsonb
);

create index idx_contact_imports_org_time
  on public.contact_imports (organization_id, started_at desc);

alter table public.contact_imports enable row level security;
-- RLS on with no policies: service_role only (API routes use admin client).

-- ── 3. import_id FK on contacts ──────────────────────────────
alter table public.contacts
  add column import_id uuid references public.contact_imports(id) on delete set null;

create index idx_contacts_import_id
  on public.contacts (import_id)
  where import_id is not null;

-- ── 4. Safety net: fail closed if dupes still exist ──────────
-- If this raises, the pre-flight dedupe wasn't completed. Migration
-- aborts, no data mutated. Resolve the duplicates and re-run.
do $$
declare
  dup_count int;
begin
  select count(*) into dup_count
    from (
      select 1
        from public.contacts
       where email is not null
         and deleted_at is null
       group by organization_id, lower(email)
      having count(*) > 1
    ) d;

  if dup_count > 0 then
    raise exception
      'Cannot create unique index: % duplicate (org, email) clusters still exist. Resolve before re-running.',
      dup_count;
  end if;
end $$;

-- ── 5. Partial unique index ──────────────────────────────────
-- Enforces one contact per (org, email) at the DB layer. Soft-deleted
-- and null-email rows are excluded, so undo/null-email cases don't collide.
create unique index contacts_org_email_unique
  on public.contacts (organization_id, lower(email))
  where deleted_at is null and email is not null;

-- ── 6. contacts_active view ──────────────────────────────────
-- security_invoker=true preserves the caller's RLS context, so org
-- isolation on the base table continues to apply to view reads.
--
-- NOTE: SELECT * is captured at view-creation time. If new columns
-- are added to public.contacts, re-run `create or replace view` to
-- expose them through contacts_active.
create view public.contacts_active
  with (security_invoker = true) as
  select * from public.contacts
   where deleted_at is null;

grant select on public.contacts_active to authenticated, service_role;

commit;

-- ── Smoke tests ──────────────────────────────────────────────
--
-- (a) Schema additions:
--   select column_name from information_schema.columns
--    where table_schema='public' and table_name='contacts'
--      and column_name in ('deleted_at','import_id');
--   -- expect: 2 rows
--
-- (b) View filters correctly:
--   select count(*) filter (where deleted_at is null) as active,
--          count(*)                                  as total
--     from public.contacts;
--   select count(*) from public.contacts_active;
--   -- active == contacts_active count
--
-- (c) Unique index blocks duplicates:
--   insert into public.contacts (organization_id, first_name, email)
--     values ('<some-org-uuid>', 'Dup Test', 'dup@example.com');
--   insert into public.contacts (organization_id, first_name, email)
--     values ('<same-org-uuid>', 'Dup Test 2', 'DUP@example.com');
--   -- expect: second insert fails with unique violation
--   -- cleanup: delete from public.contacts where email ilike 'dup@example.com';
--
-- (d) Rate-limit query:
--   select count(*) from public.contact_imports
--    where organization_id = '<org>' and started_at > now() - interval '1 hour';
