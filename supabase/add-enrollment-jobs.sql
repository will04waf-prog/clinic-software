-- ── Durable enrollment job queue ──────────────────────────────
-- Replaces fire-and-forget `enrollContact(...).catch(...)` in
-- api/leads, api/capture/[slug], api/consultations (POST + PATCH).
-- Handlers insert a row here; /api/cron drains the queue.

create table if not exists public.enrollment_jobs (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  contact_id       uuid not null references public.contacts(id)      on delete cascade,
  trigger_type     text not null,
  -- new_lead | stage_changed | no_show | old_lead_reactivation
  -- | consultation_booked | consultation_completed
  stage_id         uuid references public.pipeline_stages(id) on delete set null,
  status           text not null default 'pending',
  -- pending | processing | processed | failed
  attempts         int  not null default 0,
  last_error       text,
  scheduled_at     timestamptz not null default now(),
  processed_at     timestamptz,
  created_at       timestamptz not null default now()
);

alter table public.enrollment_jobs enable row level security;

-- Staff see only their org's jobs (matches existing org_isolation pattern)
create policy "org_isolation" on public.enrollment_jobs
  using (organization_id = (
    select organization_id from public.profiles where id = auth.uid()
  ));

-- Drain-query index: the processor selects
-- WHERE status='pending' AND scheduled_at <= now() ORDER BY scheduled_at
create index if not exists enrollment_jobs_drain_idx
  on public.enrollment_jobs (status, scheduled_at)
  where status in ('pending', 'processing');

create index if not exists enrollment_jobs_org_idx
  on public.enrollment_jobs (organization_id, created_at desc);

-- Rollback:
--   drop table public.enrollment_jobs;
