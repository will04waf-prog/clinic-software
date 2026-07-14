-- TARGET ENV: STAGING (gwccilhrgxuvtmjqojpz) then PRODUCTION
-- (rvoxqjpqbchjdizdhajb), 2026-07-14. Both verified (anon/authenticated
-- grants → NONE; service_role retained).
--
-- Defense-in-depth for the RLS-enabled-no-policy tables. RLS blocks anon/
-- authenticated today, but each still carried FULL DML grants — the exact
-- single-line-of-defense anti-pattern that caused the 2026-07-12 org leak
-- (RLS accidentally off → grants exposed every column). These tables are
-- service-role only (throttles, cron locks, and demo/prospect PII); the
-- app reaches them exclusively via supabaseAdmin, so revoking anon +
-- authenticated is safe. Conditional per table so it no-ops for tables
-- absent in a given environment (staging carries only the loop schema).
do $$
declare t text;
begin
  foreach t in array array[
    'contact_imports','cron_locks','demo_prospects','demo_requests',
    'invitation_throttle','password_reset_throttle'
  ] loop
    if exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = t
    ) then
      execute format('revoke all on public.%I from anon, authenticated', t);
    end if;
  end loop;
end $$;
