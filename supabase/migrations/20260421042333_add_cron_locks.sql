-- ── Cron mutual-exclusion table ──────────────────────────────
-- Gate for cron jobs that are not yet fully idempotent. Callers
-- use try_cron_lock()/release_cron_lock() RPCs via the service role.
--
-- Why a table and not pg_try_advisory_lock: session-scoped advisory
-- locks do not work with Supabase's Supavisor pooler because acquire
-- and release RPCs land on different pooled connections and the lock
-- leaks on the originating connection.
--
-- Keys in use (keep in sync with docs/cron.md):
--   'processDueSteps'            → src/lib/automation-engine.ts
--   'sendConsultationReminders'  → src/lib/consultation-reminders.ts

create table if not exists public.cron_locks (
  lock_key     text primary key,
  locked_at    timestamptz not null default now(),
  locked_until timestamptz not null,
  locked_by    text
);

alter table public.cron_locks enable row level security;
-- No policies. Service role bypasses RLS; no other role should touch this.

-- ── Acquire: INSERT-or-UPDATE-if-expired, returns true iff caller holds the lock ──
create or replace function public.try_cron_lock(p_key text, p_ttl_seconds int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_acquired boolean;
begin
  insert into public.cron_locks (lock_key, locked_at, locked_until)
  values (p_key, now(), now() + (p_ttl_seconds || ' seconds')::interval)
  on conflict (lock_key) do update
    set locked_at    = excluded.locked_at,
        locked_until = excluded.locked_until
    where public.cron_locks.locked_until < now()
  returning true into v_acquired;

  return coalesce(v_acquired, false);
end;
$$;

-- ── Release: unconditional delete (each function uses its own key) ──
create or replace function public.release_cron_lock(p_key text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.cron_locks where lock_key = p_key;
$$;

-- ── Grants: service_role only ──
revoke all on function public.try_cron_lock(text, int)   from public, anon, authenticated;
revoke all on function public.release_cron_lock(text)    from public, anon, authenticated;
grant  execute on function public.try_cron_lock(text, int)  to service_role;
grant  execute on function public.release_cron_lock(text)   to service_role;

-- ── Smoke tests (run in Supabase SQL editor after applying) ──
-- (a) Fresh acquire:
--     select public.try_cron_lock('smoke', 10);     -- expect: true
-- (b) Second acquire while held:
--     select public.try_cron_lock('smoke', 10);     -- expect: false
-- (c) Release, then re-acquire:
--     select public.release_cron_lock('smoke');
--     select public.try_cron_lock('smoke', 10);     -- expect: true
-- Cleanup:
--     select public.release_cron_lock('smoke');

-- ── DEV ONLY — do not run in production ──────────────────────
-- Uses pg_sleep(), which holds a pooled Postgres connection for
-- the sleep duration. Safe on a local Supabase instance; avoid on
-- the prod pooler where a stuck connection can starve other queries.
--
-- (d) Acquire after TTL expiry:
--     select public.release_cron_lock('smoke');
--     select public.try_cron_lock('smoke', 2);      -- expect: true
--     select pg_sleep(3);
--     select public.try_cron_lock('smoke', 10);     -- expect: true (previous TTL expired)
--     select public.release_cron_lock('smoke');

-- ── Rollback ──
--   drop function if exists public.try_cron_lock(text, int);
--   drop function if exists public.release_cron_lock(text);
--   drop table    if exists public.cron_locks;
