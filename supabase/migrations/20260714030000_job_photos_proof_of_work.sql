-- TARGET ENV: applied to STAGING (gwccilhrgxuvtmjqojpz) first + verified,
-- then PRODUCTION (rvoxqjpqbchjdizdhajb), 2026-07-14. Both verified
-- (RLS on, anon grants 0, bucket private).
--
-- Phase 3 — PROOF OF WORK. A completed job carries one+ completion photos
-- (optionally geotagged) — the owner's #1 pain ("charged but service never
-- performed") and, once live-mode dispute evidence is wired, indisputable
-- proof of service alongside the approval record.
--
-- Files live in the PRIVATE Supabase Storage bucket 'job-photos'. All
-- access is service-role: the app uploads via an API route and the owner /
-- client read via short-lived signed URLs, so the bucket stays private and
-- no storage RLS is required. This table is the metadata + job linkage.
-- Additive; modern RLS (inline org lookup); anon revoked.
--
-- The bucket itself is created via:
--   insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
--   values ('job-photos','job-photos',false,10485760,
--           array['image/jpeg','image/png','image/webp','image/heic','image/heif'])
--   on conflict (id) do nothing;

create table if not exists public.job_photos (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  job_id           uuid not null references public.jobs(id) on delete cascade,
  storage_path     text not null,
  geo_lat          double precision,
  geo_lng          double precision,
  taken_at         timestamptz not null default now(),
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now()
);
create index if not exists job_photos_job_idx on public.job_photos(job_id);
create index if not exists job_photos_org_idx on public.job_photos(organization_id);

alter table public.job_photos enable row level security;
create policy job_photos_org_isolation on public.job_photos
  for all
  using      (organization_id in (select organization_id from public.profiles where id = auth.uid()))
  with check (organization_id in (select organization_id from public.profiles where id = auth.uid()));
grant select, insert, update, delete on public.job_photos to authenticated, service_role;
revoke all on public.job_photos from anon;
