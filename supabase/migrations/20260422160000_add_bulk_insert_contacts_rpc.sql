-- Bulk insert for the contact-import flow.
--
-- Why this exists:
--   supabase-js .insert([...500 rows...]) against a partial unique index
--   fails the ENTIRE batch when a single row collides. For a 500-row
--   chunk that means 499 legitimate rows get rejected and the clinic
--   sees "import failed" because of one weird edge-case row (case
--   variant we missed in the two-pass dedupe, whitespace drift,
--   concurrent import race).
--
-- What this does:
--   Wraps INSERT ... ON CONFLICT DO NOTHING against the partial unique
--   index contacts_org_email_unique (created in migration
--   20260422150000). Colliding rows silently drop; non-colliding rows
--   commit. The caller learns how many dropped via the skipped_count
--   return field, which the API route surfaces as a chunk-level
--   warning (ImportRowWarning with row_index=-1).
--
-- Access model:
--   SECURITY DEFINER so it runs as owner (bypasses RLS by construction).
--   EXECUTE granted only to service_role — the admin client used by
--   /api/contacts/import is the only intended caller. Not exposed to
--   anon or authenticated roles via the REST API.

begin;

create or replace function public.bulk_insert_contacts_ignore_dupes(
  p_org_id     uuid,
  p_import_id  uuid,
  p_rows       jsonb
)
returns table (inserted_count int, skipped_count int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted int;
  v_total    int;
begin
  v_total := jsonb_array_length(p_rows);

  insert into public.contacts (
    organization_id,
    first_name,
    last_name,
    email,
    phone,
    source,
    procedure_interest,
    notes,
    import_id,
    last_activity_at
  )
  select
    p_org_id,
    (r->>'first_name'),
    (r->>'last_name'),
    (r->>'email'),
    (r->>'phone'),
    (r->>'source'),
    case
      when r->'procedure_interest' is null then null
      else array(select jsonb_array_elements_text(r->'procedure_interest'))
    end,
    (r->>'notes'),
    p_import_id,
    (r->>'last_activity_at')::timestamptz
  from jsonb_array_elements(p_rows) r
  on conflict (organization_id, lower(email))
    where deleted_at is null and email is not null
  do nothing;

  -- ROW_COUNT after INSERT ... ON CONFLICT DO NOTHING reports only the
  -- rows that were actually inserted (not the skipped ones).
  get diagnostics v_inserted = row_count;

  return query select v_inserted, (v_total - v_inserted);
end;
$$;

-- Lock down access. SECURITY DEFINER bypasses RLS regardless of caller,
-- so EXECUTE grants are what matter here.
revoke all on function public.bulk_insert_contacts_ignore_dupes(uuid, uuid, jsonb)
  from public, anon, authenticated;

grant execute on function public.bulk_insert_contacts_ignore_dupes(uuid, uuid, jsonb)
  to service_role;

commit;

-- ── Smoke tests ──────────────────────────────────────────────
--
-- (a) Function exists with the expected signature & return type:
--   select
--     pg_get_function_result(oid)               as ret,
--     pg_get_function_identity_arguments(oid)   as args,
--     prosecdef                                 as security_definer
--   from pg_proc
--   where proname = 'bulk_insert_contacts_ignore_dupes';
--   -- expect:
--   --   ret             = 'TABLE(inserted_count integer, skipped_count integer)'
--   --   args            = 'p_org_id uuid, p_import_id uuid, p_rows jsonb'
--   --   security_definer = true
--
-- (b) Grants are locked to service_role only:
--   select grantee, privilege_type
--     from information_schema.routine_privileges
--    where routine_name = 'bulk_insert_contacts_ignore_dupes';
--   -- expect: exactly one row: grantee='service_role', privilege_type='EXECUTE'
--   -- (no anon, no authenticated, no public)
--
-- (c) End-to-end against a test org (run in SQL editor as service_role):
--   -- Setup: pick an org uuid, seed one existing contact to collide with.
--   --   insert into public.contacts (organization_id, first_name, email)
--   --     values ('<org-uuid>', 'Seed', 'dupe-rpc@example.com');
--   --
--   -- Call the RPC with 2 rows: one new, one colliding (case variant).
--   --   select * from public.bulk_insert_contacts_ignore_dupes(
--   --     '<org-uuid>'::uuid,
--   --     null,
--   --     jsonb_build_array(
--   --       jsonb_build_object(
--   --         'first_name','New', 'email','new-rpc@example.com',
--   --         'last_activity_at', now()::text
--   --       ),
--   --       jsonb_build_object(
--   --         'first_name','Dup', 'email','DUPE-RPC@example.com',
--   --         'last_activity_at', now()::text
--   --       )
--   --     )
--   --   );
--   -- expect: inserted_count=1, skipped_count=1
--   --
--   -- Cleanup:
--   --   delete from public.contacts
--   --    where email ilike 'dupe-rpc@example.com'
--   --       or email ilike 'new-rpc@example.com';
