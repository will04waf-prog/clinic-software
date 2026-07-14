-- TARGET ENV: applied to STAGING (gwccilhrgxuvtmjqojpz) first + verified,
-- then PRODUCTION (rvoxqjpqbchjdizdhajb) 2026-07-14. Both verified:
-- anon EXECUTE revoked, authenticated retained, 7 fns pinned, 6 indexes
-- created. Prod tables tiny at apply time (contacts 550, invoices 0,
-- estimates 1) so index builds were instant — no lock concern.
--
-- Hardening from the 2026-07-14 full-project audit (Supabase security +
-- performance advisors + code review). See memory: hardening-audit.
--
--  1. Loop-critical FK / list indexes. invoices.estimate_id and
--     invoices.job_id are `on delete set null` FKs that seq-scan invoices
--     on the parent delete; jobs.contact_id + contacts.organization_id
--     back the schedule + client-list screens; the org/created_at
--     composites back the estimate/invoice list ordering.
--  2. Revoke anon/PUBLIC EXECUTE on next_document_number(uuid,text) — it
--     is SECURITY DEFINER and increments a per-org counter, so an anon
--     caller (the anon key is public in shipped JS) could burn any org's
--     invoice/estimate numbering (permanent gaps) or insert unbounded
--     (org,kind) rows. The app calls it as the AUTHENTICATED cookie
--     client, so authenticated keeps EXECUTE and creation is unaffected.
--     Same for the legacy rls_auto_enable maintenance function.
--  3. Pin search_path on every mutable function (advisor lint 0011).
--     Dynamic by real signature so it also covers the prod-only legacy
--     voice/consultation trigger functions absent on staging.
--
-- Additive + idempotent; conditional blocks no-op for absent objects.

create index if not exists invoices_estimate_id_idx on public.invoices(estimate_id);
create index if not exists invoices_job_id_idx      on public.invoices(job_id);
create index if not exists jobs_contact_id_idx       on public.jobs(contact_id);
create index if not exists contacts_org_idx          on public.contacts(organization_id);
create index if not exists estimates_org_created_idx on public.estimates(organization_id, created_at desc);
create index if not exists invoices_org_created_idx  on public.invoices(organization_id, created_at desc);

revoke execute on function public.next_document_number(uuid, text) from anon, public;
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rls_auto_enable'
  ) then
    execute 'revoke execute on function public.rls_auto_enable() from anon, public';
  end if;
end $$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'set_updated_at','seed_default_stages','seed_stages_for_vertical',
        'touch_voice_messages_updated_at','touch_voice_examples_updated_at',
        'tz_minute_bucket','set_consultation_derived_fields'
      )
      and coalesce(array_to_string(p.proconfig, ','), '') not like '%search_path%'
  loop
    execute format('alter function %s set search_path = pg_catalog, public', r.sig);
  end loop;
end $$;
