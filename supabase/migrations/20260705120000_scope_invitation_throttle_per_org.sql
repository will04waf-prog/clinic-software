-- Phase 4 W8 follow-up — scope invitation_throttle per org.
--
-- The W8 review caught a cross-org throttle bug: invitation_throttle
-- keyed by email only means org A burning the 3/hour budget for a
-- target email also silently blocks org B's invitations to that
-- email AND leaks cross-org invite activity to org A (they can infer
-- "someone else invited this person" by hitting the throttle).
--
-- Fix: add organization_id to the throttle row so each org has its
-- own per-email budget. No data in invitation_throttle has shipped to
-- prod with a real invitation yet (the table was created in the same
-- migration as the invite flow), so a default NULL backfill is safe
-- and immediately enforced going forward.

alter table public.invitation_throttle
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade;

-- Replace the email-only index with a composite (org, email, time) so
-- the per-org throttle query is fast.
drop index if exists public.idx_invitation_throttle_email_time;
create index if not exists idx_invitation_throttle_org_email_time
  on public.invitation_throttle (organization_id, email, attempted_at desc);

comment on column public.invitation_throttle.organization_id is
  'W8 follow-up: throttle is per-org, not global, so cross-tenant DoS / activity-leak is impossible.';
