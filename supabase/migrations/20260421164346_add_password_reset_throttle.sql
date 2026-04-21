-- Per-email throttle for /api/auth/forgot-password.
-- Server route counts rows with attempted_at > now() - 1 hour and
-- silently drops the request (returns 200) once the count hits 3.
-- Only writable / readable by service_role — RLS on with no policies
-- means anon/authenticated have zero access.

create table if not exists public.password_reset_throttle (
  id            uuid        primary key default gen_random_uuid(),
  email         text        not null,
  attempted_at  timestamptz not null default now()
);

create index if not exists idx_pwr_throttle_email_time
  on public.password_reset_throttle (email, attempted_at desc);

alter table public.password_reset_throttle enable row level security;

-- ── Smoke tests ───────────────────────────────────────────────
--
-- (a) Insert three rows and verify count:
--
--   insert into public.password_reset_throttle (email) values
--     ('smoke@test.local'), ('smoke@test.local'), ('smoke@test.local');
--   select count(*) from public.password_reset_throttle
--    where email = 'smoke@test.local'
--      and attempted_at > now() - interval '1 hour';
--   -- expect: 3
--
-- (b) Clean up:
--
--   delete from public.password_reset_throttle where email = 'smoke@test.local';
--
