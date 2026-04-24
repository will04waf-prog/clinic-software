-- Harden bulk_insert_contacts_ignore_dupes against non-array
-- procedure_interest values.
--
-- Why this exists:
--   The original function (migration 20260422160000) guarded the
--   procedure_interest unwrap with `r->'procedure_interest' is null`.
--   That only catches SQL NULL — i.e. the JSON key is absent. If a
--   row supplies `procedure_interest: null` explicitly (or any other
--   non-array jsonb: string, number, bool, object), then `r->` returns
--   a jsonb-null (or other scalar), the guard evaluates to FALSE, and
--   `jsonb_array_elements_text` raises
--     "cannot extract elements from a scalar"
--   which aborts the entire INSERT — failing 499 legitimate rows
--   because of one weird row shape.
--
-- What this does:
--   Swaps the guard to `jsonb_typeof(...) is distinct from 'array'`.
--   Now anything that isn't a proper jsonb array — absent key, jsonb
--   null, strings, numbers, objects — falls through to the NULL
--   branch, and only actual arrays get unwrapped. Happy-path
--   behavior for arrays is bit-for-bit identical to before.
--
-- What this does NOT change:
--   Signature, return type, SECURITY DEFINER, search_path, and the
--   grant set are all preserved exactly. The revoke/grant block at
--   the bottom is re-issued defensively — `create or replace`
--   preserves ACLs when the signature is unchanged, but re-running
--   the grants costs nothing and guards against future signature
--   drift that would otherwise wipe them.

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
      when jsonb_typeof(r->'procedure_interest') is distinct from 'array' then null
      else array(select jsonb_array_elements_text(r->'procedure_interest'))
    end,
    (r->>'notes'),
    p_import_id,
    (r->>'last_activity_at')::timestamptz
  from jsonb_array_elements(p_rows) r
  on conflict (organization_id, lower(email))
    where deleted_at is null and email is not null
  do nothing;

  get diagnostics v_inserted = row_count;

  return query select v_inserted, (v_total - v_inserted);
end;
$$;

revoke all on function public.bulk_insert_contacts_ignore_dupes(uuid, uuid, jsonb)
  from public, anon, authenticated;

grant execute on function public.bulk_insert_contacts_ignore_dupes(uuid, uuid, jsonb)
  to service_role;

commit;

-- ── Verification queries ─────────────────────────────────────
--
-- (a) Function body contains the new guard:
--   select pg_get_functiondef(oid) ilike '%jsonb_typeof%is distinct from%array%'
--     as has_new_guard
--     from pg_proc
--    where proname = 'bulk_insert_contacts_ignore_dupes';
--   -- expect: has_new_guard = true
--
-- (b) Signature + security flag unchanged:
--   select
--     pg_get_function_result(oid)             as ret,
--     pg_get_function_identity_arguments(oid) as args,
--     prosecdef                               as security_definer
--     from pg_proc
--    where proname = 'bulk_insert_contacts_ignore_dupes';
--   -- expect:
--   --   ret             = 'TABLE(inserted_count integer, skipped_count integer)'
--   --   args            = 'p_org_id uuid, p_import_id uuid, p_rows jsonb'
--   --   security_definer = true
--
-- (c) Grants still locked to service_role only:
--   select grantee, privilege_type
--     from information_schema.routine_privileges
--    where routine_name = 'bulk_insert_contacts_ignore_dupes';
--   -- expect: exactly one row: grantee='service_role', privilege_type='EXECUTE'
--
-- (d) Behavioral check — jsonb-null procedure_interest no longer crashes.
--     Run as service_role against a test org uuid:
--       select * from public.bulk_insert_contacts_ignore_dupes(
--         '<org-uuid>'::uuid,
--         null,
--         jsonb_build_array(
--           jsonb_build_object(
--             'first_name','NullProc',
--             'email','nullproc-rpc@example.com',
--             'procedure_interest', null,
--             'last_activity_at', now()::text
--           )
--         )
--       );
--     -- expect: inserted_count=1, skipped_count=0, no error
--     -- cleanup:
--     --   delete from public.contacts where email = 'nullproc-rpc@example.com';
