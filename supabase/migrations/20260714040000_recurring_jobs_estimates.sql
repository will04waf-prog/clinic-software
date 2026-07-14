-- TARGET ENV: applied to STAGING (gwccilhrgxuvtmjqojpz) first, then
-- PRODUCTION (rvoxqjpqbchjdizdhajb), 2026-07-14. Additive.
--
-- Phase 4 — recurring work. A lawn is a repeating job; recurring jobs are
-- what will populate the future morning brief ("hoy tiene 3 trabajos").
--
--   recurrence: NULL = one-off. 'weekly'/'biweekly'/'monthly' auto-generate
--   the next job when this one is completed (app logic). 'custom' =
--   "recurring but I create each one manually" — no auto-generate.
--   recurrence_source_job_id links a generated job back to its origin for
--   chain lineage / reporting.
--
-- The owner marks recurrence when quoting (estimate); it flows to the job
-- on approval (ensureJob copies it).
alter table public.jobs
  add column if not exists recurrence text
    check (recurrence in ('weekly','biweekly','monthly','custom')),
  add column if not exists recurrence_source_job_id uuid
    references public.jobs(id) on delete set null;
create index if not exists jobs_recurrence_idx
  on public.jobs(organization_id, recurrence) where recurrence is not null;

alter table public.estimates
  add column if not exists recurrence text
    check (recurrence in ('weekly','biweekly','monthly','custom'));
