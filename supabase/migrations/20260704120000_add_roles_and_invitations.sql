-- Phase 4 W8 — Roles + Invitations foundation.
--
-- Three things land in one migration so they ship atomically:
--
--   1. profiles.role gets a CHECK constraint over the canonical set
--      ('owner','admin','staff'). Today the column is free text with
--      default 'staff' — a typo'd insert silently 403s the real owner.
--      The constraint blocks that class of bug before the first
--      non-owner profile ever exists.
--
--   2. profiles.is_active boolean default true. Deactivation is soft:
--      profiles.id ON DELETE CASCADE to auth.users means hard-deleting
--      a user wipes their consultation authorship and contact history,
--      so the "remove this teammate" button must flip a flag instead.
--
--   3. team_invitations + invitation_throttle. The invitation is OUR
--      source of truth for {org_id, role} at accept time — we never
--      trust user-mutable raw_user_meta_data. Throttle mirrors
--      password_reset_throttle so an attacker can't spam invite-send
--      to enumerate emails or burn Resend quota.
--
-- All four blocks idempotent (IF NOT EXISTS / IF EXISTS guards) so the
-- migration is safe to re-paste after partial-apply.

-- ── 1. profiles.role CHECK constraint ─────────────────────────
-- We DROP first because the legacy schema may have shipped a check
-- with a different name that we want to replace. Use a tagged dollar
-- quote to avoid Supabase Studio parser ambiguity with later DO blocks.
do $w8_role_check$
begin
  alter table public.profiles drop constraint if exists profiles_role_check;
  alter table public.profiles
    add constraint profiles_role_check
    check (role in ('owner', 'admin', 'staff'));
exception when duplicate_object then null;
end
$w8_role_check$;

-- ── 2. profiles.is_active soft-deactivate flag ────────────────
alter table public.profiles add column if not exists is_active boolean not null default true;

-- ── 3. team_invitations ───────────────────────────────────────
-- citext for email so 'Alice@CLINIC.com' and 'alice@clinic.com' match
-- for dedupe purposes. We rely on the case-insensitive comparison both
-- on insert (uniqueness within an org) and at accept time.
create extension if not exists citext;

create table if not exists public.team_invitations (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations(id) on delete cascade,
  email           citext      not null,
  role            text        not null check (role in ('admin', 'staff')),
  -- Token is generated server-side via crypto.randomBytes(32).toString('base64url')
  -- giving 256 bits of entropy. Stored as plain text because the
  -- value lives only in our DB + the email we just sent; there's no
  -- value in hashing without rotation, and rotation lives in resend.
  token           text        not null unique,
  invited_by      uuid        not null references public.profiles(id) on delete cascade,
  expires_at      timestamptz not null default (now() + interval '7 days'),
  accepted_at     timestamptz,
  revoked_at      timestamptz,
  created_at      timestamptz not null default now()
);

-- Only one PENDING invitation per (org, email) at a time. Accepted
-- or revoked invitations can coexist with a fresh one. The partial
-- index gives the "one pending" semantics without blocking history.
create unique index if not exists team_invitations_pending_per_org_email_unique
  on public.team_invitations (organization_id, email)
  where (accepted_at is null and revoked_at is null);

create index if not exists team_invitations_email_idx
  on public.team_invitations (email)
  where (accepted_at is null and revoked_at is null);

create index if not exists team_invitations_org_idx
  on public.team_invitations (organization_id, created_at desc);

-- RLS: org members can read invitations scoped to their org; mutations
-- happen via service-role inside our API routes (we re-check the role
-- in the route via requireRole, so RLS is a defense-in-depth backstop
-- not the primary gate).
alter table public.team_invitations enable row level security;

do $w8_inv_rls$
begin
  drop policy if exists team_invitations_org_isolation on public.team_invitations;
  create policy team_invitations_org_isolation
    on public.team_invitations
    for all
    using (organization_id in (
      select organization_id from public.profiles where id = auth.uid()
    ))
    with check (organization_id in (
      select organization_id from public.profiles where id = auth.uid()
    ));
end
$w8_inv_rls$;

-- ── 4. invitation_throttle ────────────────────────────────────
-- Mirrors password_reset_throttle: service-role-only writes/reads,
-- RLS enabled with no policies so anon/authenticated have zero
-- access. Throttle is per-EMAIL (not per-org) so an attacker can't
-- enumerate emails by checking which throttle.
create table if not exists public.invitation_throttle (
  id           uuid        primary key default gen_random_uuid(),
  email        citext      not null,
  attempted_at timestamptz not null default now()
);

create index if not exists idx_invitation_throttle_email_time
  on public.invitation_throttle (email, attempted_at desc);

alter table public.invitation_throttle enable row level security;

comment on table  public.team_invitations    is 'W8: pending/accepted/revoked team invites. Source of truth for (org_id, role) at accept time.';
comment on column public.profiles.is_active  is 'W8: soft-deactivate flag. Hard delete cascades from auth.users and wipes consultation/contact history — never use.';
