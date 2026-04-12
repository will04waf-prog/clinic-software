-- ============================================================
-- ClinIQ – Initial Schema
-- Run this once in the Supabase SQL Editor before first use.
-- ============================================================

create extension if not exists "uuid-ossp";

-- ============================================================
-- ORGANIZATIONS
-- ============================================================
create table organizations (
  id                      uuid primary key default uuid_generate_v4(),
  name                    text not null,
  slug                    text not null unique,
  phone                   text,
  email                   text,
  website                 text,
  timezone                text not null default 'America/New_York',
  stripe_customer_id      text,
  stripe_subscription_id  text,
  plan                    text not null default 'trial',
  plan_status             text not null default 'active',
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- ============================================================
-- PROFILES  (one row per staff user, linked to auth.users)
-- ============================================================
create table profiles (
  id               uuid primary key references auth.users on delete cascade,
  organization_id  uuid not null references organizations(id) on delete cascade,
  full_name        text not null,
  email            text not null,
  role             text not null default 'staff',
  avatar_url       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ============================================================
-- PIPELINE STAGES
-- ============================================================
create table pipeline_stages (
  id               uuid primary key default uuid_generate_v4(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  name             text not null,
  color            text not null default '#6366f1',
  position         int  not null default 0,
  is_default       boolean not null default false,
  created_at       timestamptz not null default now()
);

-- ============================================================
-- TAGS
-- ============================================================
create table tags (
  id               uuid primary key default uuid_generate_v4(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  name             text not null,
  color            text not null default '#6366f1',
  created_at       timestamptz not null default now(),
  unique (organization_id, name)
);

-- ============================================================
-- CONTACTS  (leads and patients)
-- ============================================================
create table contacts (
  id               uuid primary key default uuid_generate_v4(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  stage_id         uuid references pipeline_stages(id) on delete set null,

  first_name       text not null,
  last_name        text,
  email            text,
  phone            text,
  date_of_birth    date,

  source           text,
  -- website | referral | instagram | facebook | walkin | other

  procedure_interest  text[],
  -- stored as text array: rhinoplasty, bbl, liposuction, etc.

  status           text not null default 'lead',
  -- lead | patient | inactive

  is_archived      boolean not null default false,
  opted_out_sms    boolean not null default false,
  opted_out_email  boolean not null default false,

  notes            text,

  last_contacted_at   timestamptz,
  last_activity_at    timestamptz default now(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index contacts_org_idx    on contacts(organization_id);
create index contacts_stage_idx  on contacts(stage_id);
create index contacts_status_idx on contacts(status);
create index contacts_email_idx  on contacts(email);

-- ============================================================
-- CONTACT TAGS  (junction)
-- ============================================================
create table contact_tags (
  contact_id  uuid not null references contacts(id) on delete cascade,
  tag_id      uuid not null references tags(id)     on delete cascade,
  primary key (contact_id, tag_id)
);

-- ============================================================
-- CONSULTATIONS
-- ============================================================
create table consultations (
  id               uuid primary key default uuid_generate_v4(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  contact_id       uuid not null references contacts(id)      on delete cascade,
  assigned_to      uuid references profiles(id) on delete set null,

  scheduled_at     timestamptz not null,
  duration_min     int  not null default 60,

  type             text not null default 'in_person',
  -- in_person | virtual

  status           text not null default 'scheduled',
  -- scheduled | confirmed | completed | no_show | canceled | rescheduled

  procedure_discussed  text[],
  pre_consult_notes    text,
  post_consult_notes   text,

  reminder_24h_sent  boolean not null default false,
  reminder_2h_sent   boolean not null default false,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index consultations_org_idx        on consultations(organization_id);
create index consultations_contact_idx    on consultations(contact_id);
create index consultations_scheduled_idx  on consultations(scheduled_at);
create index consultations_status_idx     on consultations(status);

-- ============================================================
-- AUTOMATION SEQUENCES
-- ============================================================
create table automation_sequences (
  id               uuid primary key default uuid_generate_v4(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  trigger_stage_id uuid references pipeline_stages(id) on delete set null,

  name          text    not null,
  trigger_type  text    not null,
  -- new_lead | stage_changed | no_show | old_lead_reactivation
  -- consultation_booked | consultation_completed

  is_active     boolean not null default true,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ============================================================
-- SEQUENCE STEPS
-- ============================================================
create table sequence_steps (
  id           uuid primary key default uuid_generate_v4(),
  sequence_id  uuid not null references automation_sequences(id) on delete cascade,

  position     int  not null default 0,
  delay_hours  int  not null default 0,

  channel  text not null,
  -- email | sms

  subject  text,
  body     text not null,

  created_at  timestamptz not null default now()
);

-- ============================================================
-- CONTACT SEQUENCE ENROLLMENTS
-- ============================================================
create table contact_sequence_enrollments (
  id               uuid primary key default uuid_generate_v4(),
  organization_id  uuid not null references organizations(id)        on delete cascade,
  contact_id       uuid not null references contacts(id)             on delete cascade,
  sequence_id      uuid not null references automation_sequences(id) on delete cascade,

  status        text not null default 'active',
  -- active | paused | completed | canceled

  current_step  int         not null default 0,
  next_step_at  timestamptz,

  enrolled_at   timestamptz not null default now(),
  completed_at  timestamptz
);

-- Only one active enrollment per contact per sequence at a time
create unique index enrollments_one_active_idx
  on contact_sequence_enrollments(contact_id, sequence_id)
  where status = 'active';

-- Index used by the automation engine cron to find due steps
create index enrollments_next_step_idx
  on contact_sequence_enrollments(next_step_at)
  where status = 'active';

-- ============================================================
-- MESSAGES  (outbound/inbound email and SMS log)
-- ============================================================
create table messages (
  id               uuid primary key default uuid_generate_v4(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  contact_id       uuid references contacts(id)              on delete set null,
  sequence_step_id uuid references sequence_steps(id)        on delete set null,

  channel    text not null,  -- email | sms
  direction  text not null default 'outbound',  -- outbound | inbound
  status     text not null default 'queued',
  -- queued | sent | delivered | failed | opened

  subject       text,
  body          text not null,
  to_address    text not null,
  from_address  text,

  provider_id    text,
  error_message  text,

  sent_at       timestamptz,
  opened_at     timestamptz,
  delivered_at  timestamptz,

  created_at  timestamptz not null default now()
);

create index messages_contact_idx on messages(contact_id);
create index messages_org_idx     on messages(organization_id);

-- ============================================================
-- NOTIFICATIONS  (internal staff alerts)
-- ============================================================
create table notifications (
  id               uuid primary key default uuid_generate_v4(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  user_id          uuid references profiles(id) on delete cascade,

  type   text not null,
  -- new_lead | no_show | consultation_reminder | old_lead_triggered | reply_received

  title            text not null,
  body             text,
  contact_id       uuid references contacts(id)       on delete set null,
  consultation_id  uuid references consultations(id)  on delete set null,

  is_read     boolean not null default false,
  created_at  timestamptz not null default now()
);

create index notifications_user_idx on notifications(user_id, is_read);

-- ============================================================
-- ACTIVITY LOG
-- ============================================================
create table activity_log (
  id               uuid primary key default uuid_generate_v4(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  contact_id       uuid references contacts(id)   on delete cascade,
  user_id          uuid references profiles(id)   on delete set null,

  action    text not null,
  metadata  jsonb,

  created_at  timestamptz not null default now()
);

create index activity_contact_idx on activity_log(contact_id, created_at desc);

-- ============================================================
-- HELPER: resolve current user's org id  (used in RLS)
-- ============================================================
create or replace function current_org_id()
returns uuid
language sql stable
security definer
set search_path = public
as $$
  select organization_id from profiles where id = auth.uid()
$$;

-- ============================================================
-- HELPER: seed default pipeline stages for a new org
-- Called from the signup API route.
-- ============================================================
create or replace function seed_default_stages(org_id uuid)
returns void
language plpgsql
as $$
begin
  insert into pipeline_stages (organization_id, name, color, position, is_default)
  values
    (org_id, 'New Lead',             '#6366f1', 0, true),
    (org_id, 'Contacted',            '#f59e0b', 1, false),
    (org_id, 'Consultation Booked',  '#10b981', 2, false),
    (org_id, 'Consultation Done',    '#3b82f6', 3, false),
    (org_id, 'Proposal Sent',        '#8b5cf6', 4, false),
    (org_id, 'Closed – Won',         '#22c55e', 5, false),
    (org_id, 'Closed – Lost',        '#ef4444', 6, false),
    (org_id, 'No-Show',              '#f97316', 7, false),
    (org_id, 'Old Lead',             '#94a3b8', 8, false);
end;
$$;

-- ============================================================
-- TRIGGER: keep updated_at current on every update
-- ============================================================
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_updated_at before update on organizations
  for each row execute function set_updated_at();

create trigger set_updated_at before update on profiles
  for each row execute function set_updated_at();

create trigger set_updated_at before update on contacts
  for each row execute function set_updated_at();

create trigger set_updated_at before update on consultations
  for each row execute function set_updated_at();

create trigger set_updated_at before update on automation_sequences
  for each row execute function set_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table organizations              enable row level security;
alter table profiles                   enable row level security;
alter table pipeline_stages            enable row level security;
alter table tags                       enable row level security;
alter table contacts                   enable row level security;
alter table contact_tags               enable row level security;
alter table consultations              enable row level security;
alter table automation_sequences       enable row level security;
alter table sequence_steps             enable row level security;
alter table contact_sequence_enrollments enable row level security;
alter table messages                   enable row level security;
alter table notifications              enable row level security;
alter table activity_log               enable row level security;

-- All authenticated users can only see rows from their own org
create policy "org_isolation" on organizations
  for all using (id = current_org_id());

create policy "org_isolation" on profiles
  for all using (organization_id = current_org_id());

create policy "org_isolation" on pipeline_stages
  for all using (organization_id = current_org_id());

create policy "org_isolation" on tags
  for all using (organization_id = current_org_id());

create policy "org_isolation" on contacts
  for all using (organization_id = current_org_id());

create policy "org_isolation" on contact_tags
  for all using (
    contact_id in (
      select id from contacts where organization_id = current_org_id()
    )
  );

create policy "org_isolation" on consultations
  for all using (organization_id = current_org_id());

create policy "org_isolation" on automation_sequences
  for all using (organization_id = current_org_id());

create policy "org_isolation" on sequence_steps
  for all using (
    sequence_id in (
      select id from automation_sequences where organization_id = current_org_id()
    )
  );

create policy "org_isolation" on contact_sequence_enrollments
  for all using (organization_id = current_org_id());

create policy "org_isolation" on messages
  for all using (organization_id = current_org_id());

create policy "org_isolation" on notifications
  for all using (organization_id = current_org_id());

create policy "org_isolation" on activity_log
  for all using (organization_id = current_org_id());
