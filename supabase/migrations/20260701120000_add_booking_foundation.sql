-- ============================================================
-- Phase 4 W1 — Booking foundation.
--
-- Adds the supply side of a self-serve booking funnel without
-- splintering bookings into a parallel domain. A confirmed
-- booking IS a consultation; we extend the consultations table
-- with a small set of columns rather than create a sibling
-- bookings table. JUSTIFICATION:
--
--   1. Every consumer of consultations (dashboard /consultations
--      page, 24h/2h reminder cron in src/lib/consultation-
--      reminders.ts, automation engine's 'consultation_booked'
--      trigger, stage advance to "Consultation Booked", the AI
--      Twin's consultation awareness) already reads from one
--      table. Splitting bookings into a sibling table would
--      force every reader to UNION across two sources.
--
--   2. A booking is everything a consultation already is plus
--      a few supply-side links (provider, service, exact end
--      time). Adding 6 columns is cheaper than building a
--      parallel domain.
--
--   3. The hold→confirmed transition becomes a status UPDATE,
--      not a cross-table copy. status already enumerates
--      scheduled/confirmed/canceled/no_show/completed/
--      rescheduled — we extend with 'hold'.
--
-- The five new tables (providers, services, service_providers,
-- availability_rules, availability_overrides) describe the
-- supply side: who works, what they sell, when they're open,
-- and one-off exceptions. None of them reference consultations
-- back; the engine joins them in memory and emits free slots.
--
-- Race prevention is a Postgres EXCLUDE constraint on
-- consultations using a tstzrange generated column. When two
-- patients race for the same slot, exactly one INSERT wins;
-- the loser sees SQLSTATE 23P01 which the API maps to HTTP 409.
-- The btree_gist extension is required.
--
-- Holds are auditable: an expired hold becomes status='canceled'
-- with held_until in the past — never deleted. The cron sweep
-- (added separately in src/app/api/cron/route.ts) sets that
-- status; the partial index consultations_hold_expiry_idx makes
-- the sweep cheap.
--
-- Every ADD COLUMN is on a single line so Supabase Studio's SQL
-- editor parses it cleanly. CHECK additions are wrapped in
-- DO blocks to keep re-runs idempotent, matching the pattern in
-- 20260628120000_add_auto_send_rollout.sql.
-- ============================================================

create extension if not exists btree_gist;

-- ------------------------------------------------------------
-- providers
-- ------------------------------------------------------------
-- Display label for the human (or persona) a patient is booking
-- with. profile_id is nullable because a clinic may add a part-
-- time injector who has no dashboard login. Buffers live on the
-- provider, not the service, because cleanup time is a property
-- of the room/practitioner, not the appointment.
create table if not exists public.providers (
  id                 uuid primary key default uuid_generate_v4(),
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  profile_id         uuid references public.profiles(id) on delete set null,
  display_name       text not null,
  role_label         text,
  photo_url          text,
  is_active          boolean not null default true,
  buffer_before_min  int not null default 0   check (buffer_before_min  >= 0 and buffer_before_min  <= 240),
  buffer_after_min   int not null default 15  check (buffer_after_min   >= 0 and buffer_after_min   <= 240),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists providers_org_idx on public.providers(organization_id) where is_active = true;

alter table public.providers enable row level security;

create policy providers_org_isolation on public.providers
  for all
  using      (organization_id in (select organization_id from public.profiles where id = auth.uid()))
  with check (organization_id in (select organization_id from public.profiles where id = auth.uid()));

grant select, insert, update, delete on public.providers to authenticated, service_role;

create trigger set_updated_at before update on public.providers
  for each row execute function set_updated_at();

-- ------------------------------------------------------------
-- services
-- ------------------------------------------------------------
-- A bookable unit ("Botox consult — 30 min"). Distinct from the
-- existing organizations.procedures text[] which feeds intake-
-- form procedure_interest: procedures = clinical taxonomy,
-- services = bookable units. They coexist; W1 does not migrate
-- one into the other.
--
-- lead_time_hours: minimum notice patients must give before a
-- slot's start. booking_horizon_days: how far into the future
-- patients may book. Both are duration-based and DST-invariant.
create table if not exists public.services (
  id                    uuid primary key default uuid_generate_v4(),
  organization_id       uuid not null references public.organizations(id) on delete cascade,
  name                  text not null,
  description           text,
  duration_min          int not null check (duration_min >= 5 and duration_min <= 480),
  price_cents           int  check (price_cents is null or price_cents >= 0),
  lead_time_hours       int not null default 24  check (lead_time_hours      >= 0 and lead_time_hours      <= 720),
  booking_horizon_days  int not null default 60  check (booking_horizon_days >= 1 and booking_horizon_days <= 365),
  is_active             boolean not null default true,
  is_bookable_online    boolean not null default true,
  color                 text,
  position              int not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists services_org_idx on public.services(organization_id) where is_active = true;

alter table public.services enable row level security;

create policy services_org_isolation on public.services
  for all
  using      (organization_id in (select organization_id from public.profiles where id = auth.uid()))
  with check (organization_id in (select organization_id from public.profiles where id = auth.uid()));

grant select, insert, update, delete on public.services to authenticated, service_role;

create trigger set_updated_at before update on public.services
  for each row execute function set_updated_at();

-- ------------------------------------------------------------
-- service_providers
-- ------------------------------------------------------------
-- Join table: which providers can perform which services. A
-- service with no rows here is never bookable — the engine
-- resolves serviceId → providers → unions their availability.
-- organization_id is denormalized so the same RLS policy shape
-- (org_id in profiles.org_id) works without joining either
-- parent.
create table if not exists public.service_providers (
  service_id       uuid not null references public.services(id)  on delete cascade,
  provider_id      uuid not null references public.providers(id) on delete cascade,
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  created_at       timestamptz not null default now(),
  primary key (service_id, provider_id)
);

create index if not exists service_providers_provider_idx on public.service_providers(provider_id);
create index if not exists service_providers_org_idx      on public.service_providers(organization_id);

alter table public.service_providers enable row level security;

create policy service_providers_org_isolation on public.service_providers
  for all
  using      (organization_id in (select organization_id from public.profiles where id = auth.uid()))
  with check (organization_id in (select organization_id from public.profiles where id = auth.uid()));

grant select, insert, update, delete on public.service_providers to authenticated, service_role;

-- ------------------------------------------------------------
-- availability_rules
-- ------------------------------------------------------------
-- Recurring weekly hours. Times are stored as HH:MM STRINGS in
-- CLINIC-LOCAL time and converted to UTC per-date inside the
-- engine. This is the only DST-safe approach: storing "09:00"
-- means the provider opens at 9am wall-clock on the spring-
-- forward Sunday too — the engine produces a different UTC
-- instant that day without us doing offset arithmetic.
--
-- Cross-midnight rules are disallowed; the user splits them
-- into two rows. Multiple rows per (provider, weekday) are
-- allowed to model lunch breaks (9-12 + 13-17).
create table if not exists public.availability_rules (
  id               uuid primary key default uuid_generate_v4(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  provider_id      uuid not null references public.providers(id)     on delete cascade,
  weekday          smallint not null check (weekday between 0 and 6),
  start_time       text not null check (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  end_time         text not null check (end_time   ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  created_at       timestamptz not null default now(),
  check (end_time > start_time)
);

create index if not exists availability_rules_provider_weekday_idx on public.availability_rules(provider_id, weekday);
create index if not exists availability_rules_org_idx              on public.availability_rules(organization_id);

alter table public.availability_rules enable row level security;

create policy availability_rules_org_isolation on public.availability_rules
  for all
  using      (organization_id in (select organization_id from public.profiles where id = auth.uid()))
  with check (organization_id in (select organization_id from public.profiles where id = auth.uid()));

grant select, insert, update, delete on public.availability_rules to authenticated, service_role;

-- ------------------------------------------------------------
-- availability_overrides
-- ------------------------------------------------------------
-- One-off exceptions to the weekly schedule. Two scopes via
-- provider_id NULL = clinic-wide (holiday) vs NOT NULL =
-- provider-specific (vacation). Two kinds: 'closed' nullifies
-- the day; 'custom' replaces the rule-derived intervals with
-- one-off start..end times.
--
-- Precedence the engine enforces:
--   - any clinic-wide closed → closed for everyone that date.
--   - any provider-specific closed → closed for that provider.
--   - any custom rows → REPLACE the rule-derived intervals with
--     the union of those custom rows.
create table if not exists public.availability_overrides (
  id               uuid primary key default uuid_generate_v4(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  provider_id      uuid references public.providers(id) on delete cascade,
  kind             text not null check (kind in ('closed', 'custom')),
  date             date not null,
  start_time       text check (start_time is null or start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  end_time         text check (end_time   is null or end_time   ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  reason           text,
  created_at       timestamptz not null default now(),
  check (kind <> 'custom' or (start_time is not null and end_time is not null and end_time > start_time))
);

create index if not exists availability_overrides_org_date_idx      on public.availability_overrides(organization_id, date);
create index if not exists availability_overrides_provider_date_idx on public.availability_overrides(provider_id, date) where provider_id is not null;

alter table public.availability_overrides enable row level security;

create policy availability_overrides_org_isolation on public.availability_overrides
  for all
  using      (organization_id in (select organization_id from public.profiles where id = auth.uid()))
  with check (organization_id in (select organization_id from public.profiles where id = auth.uid()));

grant select, insert, update, delete on public.availability_overrides to authenticated, service_role;

-- ============================================================
-- Extend consultations.
-- Each ADD COLUMN on its own line and wrapped via IF NOT EXISTS
-- so re-runs are idempotent.
-- ============================================================

alter table public.consultations add column if not exists provider_id  uuid references public.providers(id) on delete set null;

alter table public.consultations add column if not exists service_id   uuid references public.services(id)  on delete set null;

alter table public.consultations add column if not exists booked_via   text not null default 'manual';

alter table public.consultations add column if not exists hold_token   uuid;

alter table public.consultations add column if not exists held_until   timestamptz;

-- end_at is a stored generated column so the EXCLUDE constraint
-- has something deterministic to range over. duration_min is
-- already on the table.
alter table public.consultations add column if not exists end_at timestamptz generated always as (scheduled_at + (duration_min * interval '1 minute')) stored;

-- time_range is the tstzrange the EXCLUDE constraint uses.
-- Half-open [start, end) is the canonical Postgres range form
-- so back-to-back appointments do not collide.
alter table public.consultations add column if not exists time_range tstzrange generated always as (tstzrange(scheduled_at, scheduled_at + (duration_min * interval '1 minute'), '[)')) stored;

-- booked_via enum-by-check. DO block keeps reruns safe.
do $$
begin
  alter table public.consultations
    add constraint consultations_booked_via_check
    check (booked_via in ('manual', 'public_page', 'ai_twin', 'api'));
exception when duplicate_object then null;
end$$;

-- Status enum-by-check. The legacy table had no constraint on
-- status at all (just a default of 'scheduled'). Adding one
-- explicitly that includes 'hold' so the booking lifecycle is
-- documented in the schema. DROP first in case a prior partial
-- migration left a stale version behind.
do $$
begin
  alter table public.consultations drop constraint if exists consultations_status_check;
  alter table public.consultations
    add constraint consultations_status_check
    check (status in ('hold', 'scheduled', 'confirmed', 'completed', 'no_show', 'canceled', 'rescheduled'));
exception when duplicate_object then null;
end$$;

-- The race-prevention guarantee. GIST EXCLUDE on
-- (provider_id =, time_range &&) means: no two rows with the
-- same provider may have overlapping time ranges, but only
-- among rows that are actually holding the slot
-- (status in hold/scheduled/confirmed AND provider_id set).
-- Legacy rows with provider_id NULL are untouched.
do $$
begin
  alter table public.consultations
    add constraint consultations_no_provider_overlap
    exclude using gist (provider_id with =, time_range with &&)
    where (status in ('hold', 'scheduled', 'confirmed') and provider_id is not null);
exception when duplicate_object then null;
end$$;

-- Helper index for the engine's "fetch existing bookings in
-- window for these providers" query.
create index if not exists consultations_provider_time_idx on public.consultations using gist (provider_id, time_range);

-- Partial index for the hold-expiry cron sweep. Only the rows
-- still holding need to be scanned.
create index if not exists consultations_hold_expiry_idx on public.consultations(held_until) where status = 'hold';

comment on column public.consultations.provider_id is
  'W1: which provider owns this slot. Null for legacy rows and manual consultations with no provider chosen.';

comment on column public.consultations.service_id is
  'W1: which service was booked. Null for legacy rows. duration_min is copied at insert time so service-table edits do not retroactively alter past bookings.';

comment on column public.consultations.booked_via is
  'W1: provenance — manual (dashboard create), public_page (W2), ai_twin (W3), api.';

comment on column public.consultations.hold_token is
  'W1: opaque token returned at hold creation. Required by /api/booking/confirm to convert hold → scheduled.';

comment on column public.consultations.held_until is
  'W1: wall-clock expiry of a hold. Null when status != hold. Cron sweeps rows where status=hold AND held_until < now() to status=canceled.';

comment on column public.consultations.end_at is
  'W1: generated as scheduled_at + duration_min. Stored so the EXCLUDE constraint and downstream calendar views have a real column.';

comment on column public.consultations.time_range is
  'W1: generated tstzrange [scheduled_at, end_at). Powers the EXCLUDE constraint that prevents provider double-booking.';
